// Package backendtest runs an in-memory ai-grid-backend for handler tests.
package backendtest

import (
	"context"
	"maps"
	"net"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/fakebackend/celfilter"
)

// Fake answers the console's draft API, as the console's fake backend serves
// it (`make run-fake`), from fixed data; CatalogItems and the draft-only
// methods it has no data for answer Unimplemented. Set Err to make every
// RPC fail with that status, or Errs to fail one RPC by method name
// ("UpdateManagedCluster"), so a read can succeed and the write that follows
// it fail. Calls lists the methods reached, in order, and Metadata records the
// incoming metadata of the last call so tests can assert on identity
// forwarding. Clusters are served as given: the derived `status.state` is
// whatever the test put there, so handler tests control it directly. The
// cluster list is by name, paged by offset and limit with the whole count as
// `total`, and a filter is InvalidArgument, as in the fake backend;
// LastListClusters keeps the request.
// Updates mutate the slice in place and bump `resource_version`, except an
// update that changes nothing, which keeps it (as the fake backend and the
// API server do); LastUpdate keeps the last request, reached or refused.
// Tenants follow the same idea with the few Keycloak rules a handler test
// needs (ids `t-<n>`, duplicate name 409, NotFound); the Last*Tenant fields
// keep the last request of each tenant RPC, reached or refused; a tenant's
// `resource_version` is compared when Update or Delete carries one (Aborted
// on a mismatch) and bumped by every update, counting from whatever the test
// seeded (empty counts as 0). Capabilities is what GetHubCapabilities answers, Unimplemented when nil like
// the backend.
//
// Each RPC runs under a lock, so concurrent calls are safe. A test reads the
// recorded fields after its call returned: the answer orders them.
type Fake struct {
	aigridv1.UnimplementedAiGridServer
	aigridv1.UnimplementedTenantsServer
	aigridv1.UnimplementedGridServer
	aigridv1.UnimplementedModelsServer
	aigridv1.UnimplementedCatalogItemsServer

	Clusters []*aigridv1.ManagedCluster
	Tenants  []*aigridv1.Tenant
	Err      error
	Errs     map[string]error
	Calls    []string
	Metadata metadata.MD

	LastListTenants  *aigridv1.ListTenantsRequest
	LastCreateTenant *aigridv1.CreateTenantRequest
	LastUpdateTenant *aigridv1.UpdateTenantRequest
	LastDeleteTenant *aigridv1.DeleteTenantRequest
	// lastTenantID is the highest `t-<n>` handed out or seeded, so an id is
	// never reused after a delete.
	lastTenantID int

	Capabilities *aigridv1.HubCapabilities

	// Metrics and OverviewTime are GetOverview's metrics and updated_at.
	Metrics      []*aigridv1.Metric
	OverviewTime *timestamppb.Timestamp
	LastOverview *aigridv1.GetOverviewRequest

	mu sync.Mutex
}

// stale is the Aborted answer to an expected version that is not the stored one.
func stale(id, stored, expected string) error {
	return status.Errorf(codes.Aborted, "object with identifier '%s' has resource version %s, the request carries %q", id, stored, expected)
}

// nextVersion is the stored version plus one; a non-numeric or empty one
// counts as 0.
func nextVersion(v string) string {
	n, _ := strconv.Atoi(v)
	return strconv.Itoa(n + 1)
}

// begin records the call and returns the injected error for it, if any. It
// also notes the tenant ids present so far, before a delete can remove one.
func (f *Fake) begin(ctx context.Context, method string) error {
	md, _ := metadata.FromIncomingContext(ctx)
	f.Metadata = md
	f.noteTenantIDs()
	f.Calls = append(f.Calls, method)
	if f.Err != nil {
		return f.Err
	}
	return f.Errs[method]
}

// Reached reports whether the named RPC was called.
func (f *Fake) Reached(method string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Contains(f.Calls, method)
}

// Ping implements AiGrid.
func (f *Fake) Ping(ctx context.Context, req *aigridv1.PingRequest) (*aigridv1.PingResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.begin(ctx, "Ping"); err != nil {
		return nil, err
	}
	return &aigridv1.PingResponse{Message: "pong " + req.GetName()}, nil
}

// ListTenants implements Tenants: name order, `offset`/`limit` paging and
// `filter` evaluated as CEL over `this` (a Tenant) with the fake backend's
// evaluator (celfilter: cel-go plus its strings extension), so a handler test
// sees the same matches and the same InvalidArgument answers; `total` counts
// the filtered set.
func (f *Fake) ListTenants(ctx context.Context, req *aigridv1.ListTenantsRequest) (*aigridv1.ListTenantsResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.begin(ctx, "ListTenants"); err != nil {
		return nil, err
	}
	f.LastListTenants = req
	filter, err := celfilter.Compile(req.GetFilter(), &aigridv1.Tenant{})
	if err != nil {
		return nil, err
	}
	sorted := slices.Clone(f.Tenants)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].GetName() < sorted[j].GetName() })
	var all []*aigridv1.Tenant
	for _, t := range sorted {
		ok, err := filter.Match(ctx, t, t.GetId(), time.Now())
		if err != nil {
			return nil, err
		}
		if ok {
			all = append(all, t)
		}
	}
	total := len(all)
	page := all[min(int(req.GetOffset()), total):]
	if req.Limit != nil && int(req.GetLimit()) < len(page) {
		page = page[:req.GetLimit()]
	}
	return &aigridv1.ListTenantsResponse{Tenants: page, Size: int32(len(page)), Total: proto.Int32(int32(total))}, nil
}

// GetTenant implements Tenants with the backend's NotFound message.
func (f *Fake) GetTenant(ctx context.Context, req *aigridv1.GetTenantRequest) (*aigridv1.GetTenantResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.begin(ctx, "GetTenant"); err != nil {
		return nil, err
	}
	t := f.findTenant(req.GetId())
	if t == nil {
		return nil, status.Errorf(codes.NotFound, "object with identifier '%s' not found", req.GetId())
	}
	return &aigridv1.GetTenantResponse{Object: t}, nil
}

// CreateTenant implements Tenants: assigns the next `t-<n>` (monotonic, past
// every seeded or deleted id), defaults the alias to the name and `enabled`
// to true, mirrors `domains` into `domain_details`, 409 on a taken name with
// Keycloak's message.
func (f *Fake) CreateTenant(ctx context.Context, req *aigridv1.CreateTenantRequest) (*aigridv1.CreateTenantResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.LastCreateTenant = req
	if err := f.begin(ctx, "CreateTenant"); err != nil {
		return nil, err
	}
	t := proto.Clone(req.GetObject()).(*aigridv1.Tenant)
	if t.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "Name can not be null")
	}
	for _, other := range f.Tenants {
		if other.GetName() == t.GetName() {
			return nil, status.Error(codes.AlreadyExists, "A organization with the same name already exists.")
		}
	}
	if t.GetAlias() == "" {
		t.Alias = t.GetName()
	}
	if t.Enabled == nil {
		t.Enabled = proto.Bool(true)
	}
	if len(t.GetDomainDetails()) == 0 {
		for _, d := range t.GetDomains() {
			t.DomainDetails = append(t.DomainDetails, &aigridv1.TenantDomain{Name: d})
		}
	}
	t.Id = f.nextTenantID()
	t.ResourceVersion = "1"
	f.Tenants = append(f.Tenants, t)
	return &aigridv1.CreateTenantResponse{Object: t}, nil
}

// UpdateTenant implements Tenants: applies the mask paths in place. `alias`
// keeps the stored alias (a different non-blank one is Keycloak's
// InvalidArgument, whatever the mask); an update that changes nothing keeps
// the version, as the fake backend skips the PUT.
func (f *Fake) UpdateTenant(ctx context.Context, req *aigridv1.UpdateTenantRequest) (*aigridv1.UpdateTenantResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.LastUpdateTenant = req
	if err := f.begin(ctx, "UpdateTenant"); err != nil {
		return nil, err
	}
	t := f.findTenant(req.GetObject().GetId())
	if t == nil {
		return nil, status.Errorf(codes.NotFound, "object with identifier '%s' not found", req.GetObject().GetId())
	}
	if rv := req.GetObject().GetResourceVersion(); rv != "" && rv != t.GetResourceVersion() {
		return nil, stale(t.GetId(), t.GetResourceVersion(), rv)
	}
	if alias := req.GetObject().GetAlias(); alias != "" && alias != t.GetAlias() {
		return nil, status.Error(codes.InvalidArgument, "Cannot change the alias")
	}
	obj := req.GetObject()
	before := proto.Clone(t).(*aigridv1.Tenant)
	for _, p := range req.GetUpdateMask().GetPaths() {
		switch p {
		case "alias":
		case "name":
			// Keycloak's PUT answers a blank name with 409: its exact name
			// search treats a blank term as no filter and finds the
			// organization itself (OrganizationResource.java L123-125).
			if strings.TrimSpace(obj.GetName()) == "" {
				return nil, status.Error(codes.AlreadyExists, "A organization with the same name already exists.")
			}
			t.Name = obj.GetName()
		case "enabled":
			t.Enabled = proto.Bool(obj.GetEnabled())
		case "description":
			t.Description = obj.GetDescription()
		case "attributes":
			t.Attributes = maps.Clone(obj.GetAttributes())
		case "domains":
			// Names only; unlike the real fake this drops the metadata of a
			// domain that stays, which handler tests do not depend on.
			t.Domains = slices.Clone(obj.GetDomains())
			t.DomainDetails = nil
			for _, d := range t.Domains {
				t.DomainDetails = append(t.DomainDetails, &aigridv1.TenantDomain{Name: d})
			}
		case "identity_provider":
			t.IdentityProvider = obj.GetIdentityProvider()
		case "domain_details":
			t.DomainDetails = obj.GetDomainDetails()
			t.Domains = nil
			for _, d := range t.DomainDetails {
				t.Domains = append(t.Domains, d.GetName())
			}
		default:
			return nil, status.Errorf(codes.InvalidArgument, "update_mask path %q is not supported", p)
		}
	}
	if !proto.Equal(before, t) {
		t.ResourceVersion = nextVersion(t.GetResourceVersion())
	}
	return &aigridv1.UpdateTenantResponse{Object: t}, nil
}

// DeleteTenant implements Tenants.
func (f *Fake) DeleteTenant(ctx context.Context, req *aigridv1.DeleteTenantRequest) (*aigridv1.DeleteTenantResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.LastDeleteTenant = req
	if err := f.begin(ctx, "DeleteTenant"); err != nil {
		return nil, err
	}
	for i, t := range f.Tenants {
		if t.GetId() == req.GetId() {
			if rv := req.GetResourceVersion(); rv != "" && rv != t.GetResourceVersion() {
				return nil, stale(t.GetId(), t.GetResourceVersion(), rv)
			}
			f.Tenants = slices.Delete(f.Tenants, i, i+1)
			return &aigridv1.DeleteTenantResponse{}, nil
		}
	}
	return nil, status.Errorf(codes.NotFound, "object with identifier '%s' not found", req.GetId())
}

// noteTenantIDs raises lastTenantID to the highest `t-<n>` currently
// present (seeded ids included), so a later delete cannot free a number.
func (f *Fake) noteTenantIDs() {
	for _, t := range f.Tenants {
		if n, err := strconv.Atoi(strings.TrimPrefix(t.GetId(), "t-")); err == nil && n > f.lastTenantID {
			f.lastTenantID = n
		}
	}
}

// nextTenantID returns the next unused `t-<n>`: one past the highest number
// ever seen among the seeded ids and the ids handed out, deleted or not.
func (f *Fake) nextTenantID() string {
	f.noteTenantIDs()
	f.lastTenantID++
	return "t-" + strconv.Itoa(f.lastTenantID)
}

func (f *Fake) findTenant(id string) *aigridv1.Tenant {
	for _, t := range f.Tenants {
		if t.GetId() == id {
			return t
		}
	}
	return nil
}

// GetHubCapabilities implements AiGrid: Unimplemented until Capabilities is set.
func (f *Fake) GetHubCapabilities(ctx context.Context, _ *aigridv1.GetHubCapabilitiesRequest) (*aigridv1.GetHubCapabilitiesResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.begin(ctx, "GetHubCapabilities"); err != nil {
		return nil, err
	}
	if f.Capabilities == nil {
		return nil, status.Error(codes.Unimplemented, "method GetHubCapabilities not implemented")
	}
	return &aigridv1.GetHubCapabilitiesResponse{Capabilities: f.Capabilities}, nil
}

// GetOverview implements Grid: it records the request and answers with the
// clusters labelled ai-grid/enabled=true (and ai-grid/site=site when set), and
// Metrics when include_metrics is set.
func (f *Fake) GetOverview(ctx context.Context, req *aigridv1.GetOverviewRequest) (*aigridv1.GetOverviewResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.LastOverview = req
	if err := f.begin(ctx, "GetOverview"); err != nil {
		return nil, err
	}
	resp := &aigridv1.GetOverviewResponse{
		UpdatedAt:       f.OverviewTime,
		InventorySource: aigridv1.InventorySource_INVENTORY_SOURCE_ACM,
		MetricsSource:   aigridv1.MetricsSource_METRICS_SOURCE_DEMO,
	}
	for _, c := range f.Clusters {
		if c.GetLabels()["ai-grid/enabled"] == "true" && (req.Site == nil || c.GetLabels()["ai-grid/site"] == req.GetSite()) {
			resp.Clusters = append(resp.Clusters, c)
		}
	}
	if req.GetIncludeMetrics() {
		resp.Metrics = f.Metrics
	}
	return resp, nil
}

// Status is a shorthand for a gRPC error.
func Status(code codes.Code, msg string) error { return status.Error(code, msg) }

// Start serves the fake over an in-memory connection and returns a client
// dialed for the console's draft API, as `make run-fake` dials the fake
// backend (DraftAPI). Both are stopped when the test ends. StartV1 serves the
// backend's own API, which production calls.
func Start(t *testing.T, fake *Fake) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	aigridv1.RegisterAiGridServer(srv, fake)
	aigridv1.RegisterTenantsServer(srv, fake)
	aigridv1.RegisterGridServer(srv, fake)
	aigridv1.RegisterModelsServer(srv, fake)
	aigridv1.RegisterCatalogItemsServer(srv, fake)
	return serve(t, srv, backend.Config{DraftAPI: true})
}

// serve runs srv over an in-memory connection and dials it with cfg (the
// address and transport are set here). Both are stopped when the test ends.
func serve(t *testing.T, srv *grpc.Server, cfg backend.Config) *backend.Client {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	go func() { _ = srv.Serve(lis) }()

	cfg.Address, cfg.Insecure = "passthrough:///bufconn", true
	client, err := backend.Dial(cfg, grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = client.Close()
		srv.Stop()
	})
	return client
}
