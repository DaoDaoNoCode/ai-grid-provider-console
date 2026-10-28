package backendtest

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// V1ModelsNamespace is the models namespace StartV1 dials with
// (backend.Config.ModelsNamespace): the backend's models have none, so the
// BFF reports them, and expects them, in this one.
const V1ModelsNamespace = "ai-grid-models"

// V1 answers the backend's own API, ai_grid.v1 as ai-grid-provider-backend
// serves it, which is what production calls through the adapters in
// internal/backend (v1.go, v1_models.go): AiGrid (Ping only), Clusters,
// Tenants, Models and Subscriptions on the backend's method paths, with the
// messages of the BFF's copy of its proto (ai_grid.backend.v1). The backend
// has no Grid service and no capabilities, so those answer Unimplemented, and
// so does every method it doesn't have.
//
// The rules are the backend's at ca83c8d (internal/servers), as far as a
// handler test needs them:
//   - metadata.version is the lock. An Update with lock and version 0 is
//     InvalidArgument; a nonzero version other than the stored one is Aborted;
//     and an update stores version + 1 (clusters_server.go Update,
//     models_git.go and subscriptions_git.go gitUpdate). A cluster update that
//     changes nothing keeps its version, as the API server does. A Delete
//     with a nonzero version other than the stored one is Aborted (gitDelete).
//   - A tenant Update or Delete without a version is InvalidArgument
//     (tenants_server.go errTenantVersionRequired), and a tenant update
//     stores version + 1.
//   - The update_mask paths are the backend's own (metadata.labels,
//     spec.domains, ...). A cluster path it doesn't know changes nothing
//     (updatePaths); a tenant or model path it doesn't know is
//     InvalidArgument (tenantUpdatePaths, parseModelUpdateMask).
//   - Lists of clusters, tenants and models page by offset and limit and
//     count every item in total (applyListWindow). Neither Clusters nor
//     Tenants evaluates filter.
//   - NotFound, AlreadyExists and Aborted carry the backend's messages.
//
// Left out: the console-key rules on cluster labels (the request's maps are
// stored as sent), Keycloak's and Git's validation, and every status, which
// is served as seeded.
//
// Seed the exported fields before StartV1. Each call is handled under a lock,
// so concurrent calls are safe; read Calls and Metadata after a call returned.
type V1 struct {
	Clusters           []*backendv1.ManagedCluster
	Tenants            []*backendv1.Tenant
	Models             []*backendv1.Model
	Subscriptions      []*backendv1.Subscription
	AuthPolicies       []*backendv1.AuthPolicy
	ModelRegistrations []*backendv1.ModelRegistration
	// Locations is what Models/ListPlacementClusters answers (its clusters).
	Locations []string
	// Err makes every call fail with this status.
	Err error

	mu       sync.Mutex
	calls    []string
	metadata metadata.MD
	tenantID int
}

// Calls returns the methods reached, as full method paths, in order.
func (v *V1) Calls() []string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return slices.Clone(v.calls)
}

// Metadata returns the incoming metadata of the last call.
func (v *V1) Metadata() metadata.MD {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.metadata.Copy()
}

// StartV1 serves v over an in-memory connection and returns a client dialed
// the way production dials the real backend (DraftAPI unset). Both are
// stopped when the test ends.
func StartV1(t *testing.T, v *V1) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.AiGrid", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "Ping", v.ping),
	}}, v)
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.Clusters", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "List", v.listClusters),
		unary(v, "Get", v.getCluster),
		unary(v, "Update", v.updateCluster),
	}}, v)
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.Tenants", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "List", v.listTenants),
		unary(v, "Get", v.getTenant),
		unary(v, "Create", v.createTenant),
		unary(v, "Update", v.updateTenant),
		unary(v, "Delete", v.deleteTenant),
	}}, v)
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.Models", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "List", v.listModels),
		unary(v, "Get", v.getModel),
		unary(v, "Create", v.createModel),
		unary(v, "Update", v.updateModel),
		unary(v, "Delete", v.deleteModel),
		unary(v, "ListPlacementClusters", v.listPlacementClusters),
	}}, v)
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.Subscriptions", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "List", v.listSubscriptions),
		unary(v, "Get", v.getSubscription),
		unary(v, "Create", v.createSubscription),
		unary(v, "Update", v.updateSubscription),
		unary(v, "Delete", v.deleteSubscription),
	}}, v)
	return serve(t, srv, backend.Config{ModelsNamespace: V1ModelsNamespace})
}

// unary is the grpc.MethodDesc of one method, as protoc-gen-go-grpc would
// generate it: decode the request, then call the handler under v's lock,
// after recording the call and failing it with v.Err when set.
func unary[Req any, PReq interface {
	*Req
	proto.Message
}, Resp proto.Message](v *V1, name string, handle func(PReq) (Resp, error)) grpc.MethodDesc {
	return grpc.MethodDesc{MethodName: name, Handler: func(_ any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
		in := PReq(new(Req))
		if err := dec(in); err != nil {
			return nil, err
		}
		method, _ := grpc.Method(ctx)
		md, _ := metadata.FromIncomingContext(ctx)
		v.mu.Lock()
		defer v.mu.Unlock()
		v.calls, v.metadata = append(v.calls, method), md
		if v.Err != nil {
			return nil, v.Err
		}
		return handle(in)
	}}
}

// window is the backend's applyListWindow: offset then limit, total over all.
func window[T any](items []T, offset, limit *int32) ([]T, int32) {
	start := min(int(max(0, ptrValue(offset))), len(items))
	end := len(items)
	if limit != nil && *limit >= 0 {
		end = min(start+int(*limit), len(items))
	}
	return items[start:end], int32(len(items))
}

func ptrValue(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

// lockedVersion is the backend's precondition on an Update: with lock the
// request must carry a version, and a nonzero version must be the stored one.
func lockedVersion(lock bool, sent, stored int32, stale error) error {
	if lock && sent == 0 {
		return status.Error(codes.InvalidArgument, "lock requires metadata.version")
	}
	if sent != 0 && sent != stored {
		return stale
	}
	return nil
}

// staleV1 is the backend's Aborted answer to a stale version, "update Model \"m\": the model changed since it was read; reload and retry".
func staleV1(op, kind, noun, id string) error {
	return status.Errorf(codes.Aborted, "%s %s %q: the %s changed since it was read; reload and retry", op, kind, id, noun)
}

func (v *V1) ping(in *aigridv1.PingRequest) (*aigridv1.PingResponse, error) {
	return &aigridv1.PingResponse{Message: "pong " + in.GetName()}, nil
}

func (v *V1) listClusters(in *backendv1.ClustersListRequest) (*backendv1.ClustersListResponse, error) {
	sorted := slices.SortedFunc(slices.Values(v.Clusters), func(a, b *backendv1.ManagedCluster) int { return cmp.Compare(a.GetId(), b.GetId()) })
	page, total := window(sorted, in.Offset, in.Limit)
	return &backendv1.ClustersListResponse{Size: int32(len(page)), Total: total, Items: clones(page)}, nil
}

func (v *V1) findCluster(id string) (int, error) {
	for i, c := range v.Clusters {
		if c.GetId() == id {
			return i, nil
		}
	}
	return 0, status.Errorf(codes.NotFound, "ManagedCluster %q not found", id)
}

func (v *V1) getCluster(in *backendv1.ClustersGetRequest) (*backendv1.ClustersGetResponse, error) {
	i, err := v.findCluster(in.GetId())
	if err != nil {
		return nil, err
	}
	return &backendv1.ClustersGetResponse{Object: proto.Clone(v.Clusters[i]).(*backendv1.ManagedCluster)}, nil
}

func (v *V1) updateCluster(in *backendv1.ClustersUpdateRequest) (*backendv1.ClustersUpdateResponse, error) {
	obj := in.GetObject()
	i, err := v.findCluster(obj.GetId())
	if err != nil {
		return nil, err
	}
	c := v.Clusters[i]
	if err := lockedVersion(in.GetLock(), obj.GetMetadata().GetVersion(), c.GetMetadata().GetVersion(), staleV1("update", "ManagedCluster", "cluster", c.GetId())); err != nil {
		return nil, err
	}
	labels, annotations := c.GetMetadata().GetLabels(), c.GetMetadata().GetAnnotations()
	for _, p := range in.GetUpdateMask().GetPaths() {
		switch p {
		case "metadata.labels":
			labels = obj.GetMetadata().GetLabels()
		case "metadata.annotations":
			annotations = obj.GetMetadata().GetAnnotations()
		}
	}
	if !maps.Equal(labels, c.GetMetadata().GetLabels()) || !maps.Equal(annotations, c.GetMetadata().GetAnnotations()) {
		next := proto.Clone(c).(*backendv1.ManagedCluster)
		if next.Metadata == nil {
			next.Metadata = &backendv1.Metadata{}
		}
		next.Metadata.Labels, next.Metadata.Annotations = maps.Clone(labels), maps.Clone(annotations)
		next.Metadata.Version++
		v.Clusters[i] = next
	}
	return &backendv1.ClustersUpdateResponse{Object: proto.Clone(v.Clusters[i]).(*backendv1.ManagedCluster)}, nil
}

func (v *V1) listTenants(in *backendv1.TenantsListRequest) (*backendv1.TenantsListResponse, error) {
	sorted := slices.SortedFunc(slices.Values(v.Tenants), func(a, b *backendv1.Tenant) int {
		return cmp.Compare(a.GetMetadata().GetName(), b.GetMetadata().GetName())
	})
	page, total := window(sorted, in.Offset, in.Limit)
	return &backendv1.TenantsListResponse{Size: int32(len(page)), Total: total, Items: clones(page)}, nil
}

func (v *V1) findTenant(id string) (int, error) {
	for i, t := range v.Tenants {
		if t.GetId() == id {
			return i, nil
		}
	}
	return 0, status.Errorf(codes.NotFound, "tenant %q not found", id)
}

func (v *V1) getTenant(in *backendv1.TenantsGetRequest) (*backendv1.TenantsGetResponse, error) {
	i, err := v.findTenant(in.GetId())
	if err != nil {
		return nil, err
	}
	return &backendv1.TenantsGetResponse{Object: proto.Clone(v.Tenants[i]).(*backendv1.Tenant)}, nil
}

// createTenant stores the tenant at version 1 under the next free `t-<n>`
// id (Keycloak assigns a UUID).
func (v *V1) createTenant(in *backendv1.TenantsCreateRequest) (*backendv1.TenantsCreateResponse, error) {
	name := in.GetObject().GetMetadata().GetName()
	if name == "" {
		return nil, status.Error(codes.InvalidArgument, "metadata.name is required")
	}
	for _, t := range v.Tenants {
		if t.GetMetadata().GetName() == name {
			return nil, status.Errorf(codes.AlreadyExists, "tenant %q already exists", name)
		}
		if n, err := strconv.Atoi(strings.TrimPrefix(t.GetId(), "t-")); err == nil && n > v.tenantID {
			v.tenantID = n
		}
	}
	v.tenantID++
	t := &backendv1.Tenant{
		Id:       "t-" + strconv.Itoa(v.tenantID),
		Metadata: &backendv1.Metadata{Name: name, Version: 1},
		Spec:     &backendv1.TenantSpec{Domains: slices.Clone(in.GetObject().GetSpec().GetDomains())},
	}
	v.Tenants = append(v.Tenants, t)
	return &backendv1.TenantsCreateResponse{Object: proto.Clone(t).(*backendv1.Tenant)}, nil
}

func (v *V1) updateTenant(in *backendv1.TenantsUpdateRequest) (*backendv1.TenantsUpdateResponse, error) {
	obj := in.GetObject()
	version := obj.GetMetadata().GetVersion()
	if version == 0 {
		return nil, status.Error(codes.InvalidArgument, "a version is required: send the organization's metadata.version")
	}
	i, err := v.findTenant(obj.GetId())
	if err != nil {
		return nil, err
	}
	t := v.Tenants[i]
	if version != t.GetMetadata().GetVersion() {
		return nil, staleV1("update", "tenant", "tenant", t.GetId())
	}
	var name, domains bool
	for _, p := range in.GetUpdateMask().GetPaths() {
		switch p {
		case "id":
		case "metadata.name":
			name = true
		case "spec.domains":
			domains = true
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path %q", p)
		}
	}
	if name || domains {
		next := proto.Clone(t).(*backendv1.Tenant)
		if name {
			next.Metadata.Name = obj.GetMetadata().GetName()
		}
		if domains {
			next.Spec = &backendv1.TenantSpec{Domains: slices.Clone(obj.GetSpec().GetDomains())}
		}
		next.Metadata.Version++
		v.Tenants[i] = next
	}
	return &backendv1.TenantsUpdateResponse{Object: proto.Clone(v.Tenants[i]).(*backendv1.Tenant)}, nil
}

func (v *V1) deleteTenant(in *backendv1.TenantsDeleteRequest) (*backendv1.TenantsDeleteResponse, error) {
	if in.GetVersion() == 0 {
		return nil, status.Error(codes.InvalidArgument, "a version is required: send the organization's metadata.version")
	}
	i, err := v.findTenant(in.GetId())
	if err != nil {
		return nil, err
	}
	if in.GetVersion() != v.Tenants[i].GetMetadata().GetVersion() {
		return nil, staleV1("delete", "tenant", "tenant", in.GetId())
	}
	v.Tenants = slices.Delete(v.Tenants, i, i+1)
	return &backendv1.TenantsDeleteResponse{}, nil
}

func (v *V1) listModels(in *backendv1.ModelsListRequest) (*backendv1.ModelsListResponse, error) {
	sorted := slices.SortedFunc(slices.Values(v.Models), func(a, b *backendv1.Model) int { return cmp.Compare(a.GetId(), b.GetId()) })
	page, total := window(sorted, in.Offset, in.Limit)
	return &backendv1.ModelsListResponse{Size: int32(len(page)), Total: total, Items: clones(page)}, nil
}

func (v *V1) findModel(id string) (int, error) {
	for i, m := range v.Models {
		if m.GetId() == id {
			return i, nil
		}
	}
	return 0, status.Errorf(codes.NotFound, "Model %q not found", id)
}

func (v *V1) getModel(in *backendv1.ModelsGetRequest) (*backendv1.ModelsGetResponse, error) {
	i, err := v.findModel(in.GetId())
	if err != nil {
		return nil, err
	}
	return &backendv1.ModelsGetResponse{Object: proto.Clone(v.Models[i]).(*backendv1.Model)}, nil
}

// createModel stores the model at version 1, named by its id.
func (v *V1) createModel(in *backendv1.ModelsCreateRequest) (*backendv1.ModelsCreateResponse, error) {
	m := proto.Clone(in.GetObject()).(*backendv1.Model)
	if m.GetId() == "" {
		m.Id = m.GetMetadata().GetName()
	}
	if _, err := v.findModel(m.GetId()); err == nil {
		return nil, status.Errorf(codes.AlreadyExists, "Model %q already exists", m.GetId())
	}
	if m.Metadata == nil {
		m.Metadata = &backendv1.Metadata{}
	}
	m.Metadata.Name, m.Metadata.Version = m.GetId(), 1
	v.Models = append(v.Models, m)
	return &backendv1.ModelsCreateResponse{Object: proto.Clone(m).(*backendv1.Model)}, nil
}

func (v *V1) updateModel(in *backendv1.ModelsUpdateRequest) (*backendv1.ModelsUpdateResponse, error) {
	obj := in.GetObject()
	i, err := v.findModel(obj.GetId())
	if err != nil {
		return nil, err
	}
	m := v.Models[i]
	if err := lockedVersion(in.GetLock(), obj.GetMetadata().GetVersion(), m.GetMetadata().GetVersion(), staleV1("update", "Model", "model", m.GetId())); err != nil {
		return nil, err
	}
	next := proto.Clone(m).(*backendv1.Model)
	if next.Spec == nil {
		next.Spec = &backendv1.ModelSpec{}
	}
	if next.Spec.Main == nil {
		next.Spec.Main = &backendv1.ModelContainer{}
	}
	for _, p := range in.GetUpdateMask().GetPaths() {
		switch p {
		case "metadata.labels":
			next.Metadata.Labels = maps.Clone(obj.GetMetadata().GetLabels())
		case "metadata.annotations":
			next.Metadata.Annotations = maps.Clone(obj.GetMetadata().GetAnnotations())
		case "spec.replicas":
			next.Spec.Replicas = obj.GetSpec().Replicas
		case "spec.main.image":
			next.Spec.Main.Image = obj.GetSpec().GetMain().GetImage()
		case "spec.main.env":
			next.Spec.Main.Env = obj.GetSpec().GetMain().GetEnv()
		case "spec.placement":
			next.Spec.Placement = obj.GetSpec().GetPlacement()
		case "spec.rollout":
			next.Spec.Rollout = obj.GetSpec().GetRollout()
		default:
			return nil, status.Errorf(codes.InvalidArgument, "update_mask path %q is not supported", p)
		}
	}
	next.Metadata.Version++
	v.Models[i] = next
	return &backendv1.ModelsUpdateResponse{Object: proto.Clone(next).(*backendv1.Model)}, nil
}

func (v *V1) deleteModel(in *backendv1.ModelsDeleteRequest) (*backendv1.ModelsDeleteResponse, error) {
	i, err := v.findModel(in.GetId())
	if err != nil {
		return nil, err
	}
	if rv := in.GetResourceVersion(); rv != 0 && rv != v.Models[i].GetMetadata().GetVersion() {
		return nil, staleV1("delete", "Model", "model", in.GetId())
	}
	v.Models = slices.Delete(v.Models, i, i+1)
	return &backendv1.ModelsDeleteResponse{}, nil
}

func (v *V1) listPlacementClusters(*backendv1.ModelsListPlacementClustersRequest) (*backendv1.ModelsListPlacementClustersResponse, error) {
	return &backendv1.ModelsListPlacementClustersResponse{Clusters: slices.Clone(v.Locations)}, nil
}

func (v *V1) listSubscriptions(*backendv1.SubscriptionsListRequest) (*backendv1.SubscriptionsListResponse, error) {
	sorted := slices.SortedFunc(slices.Values(v.Subscriptions), func(a, b *backendv1.Subscription) int { return cmp.Compare(a.GetId(), b.GetId()) })
	return &backendv1.SubscriptionsListResponse{Items: clones(sorted)}, nil
}

func (v *V1) findSubscription(id string) (int, error) {
	for i, s := range v.Subscriptions {
		if s.GetId() == id {
			return i, nil
		}
	}
	return 0, status.Errorf(codes.NotFound, "Subscription %q not found", id)
}

// getSubscription answers with every auth policy and model registration, as
// the draft Fake does.
func (v *V1) getSubscription(in *backendv1.SubscriptionsGetRequest) (*backendv1.SubscriptionsGetResponse, error) {
	i, err := v.findSubscription(in.GetId())
	if err != nil {
		return nil, err
	}
	return &backendv1.SubscriptionsGetResponse{
		Object:             proto.Clone(v.Subscriptions[i]).(*backendv1.Subscription),
		AuthPolicies:       clones(v.AuthPolicies),
		ModelRegistrations: clones(v.ModelRegistrations),
	}, nil
}

// createSubscription stores the subscription at version 1 and answers with
// its <id>-policy, which the backend always creates.
func (v *V1) createSubscription(in *backendv1.SubscriptionsCreateRequest) (*backendv1.SubscriptionsCreateResponse, error) {
	s := proto.Clone(in.GetObject()).(*backendv1.Subscription)
	if _, err := v.findSubscription(s.GetId()); err == nil {
		return nil, status.Errorf(codes.AlreadyExists, "Subscription %q already exists", s.GetId())
	}
	if s.Metadata == nil {
		s.Metadata = &backendv1.Metadata{}
	}
	s.Metadata.Name, s.Metadata.Version = s.GetId(), 1
	v.Subscriptions = append(v.Subscriptions, s)
	return &backendv1.SubscriptionsCreateResponse{
		Object:     proto.Clone(s).(*backendv1.Subscription),
		AuthPolicy: &backendv1.AuthPolicy{Id: s.GetId() + "-policy"},
	}, nil
}

func (v *V1) updateSubscription(in *backendv1.SubscriptionsUpdateRequest) (*backendv1.SubscriptionsUpdateResponse, error) {
	obj := in.GetObject()
	i, err := v.findSubscription(obj.GetId())
	if err != nil {
		return nil, err
	}
	s := v.Subscriptions[i]
	if err := lockedVersion(in.GetLock(), obj.GetMetadata().GetVersion(), s.GetMetadata().GetVersion(), staleV1("update", "Subscription", "subscription", s.GetId())); err != nil {
		return nil, err
	}
	next := proto.Clone(s).(*backendv1.Subscription)
	if next.Metadata == nil {
		next.Metadata = &backendv1.Metadata{}
	}
	for _, p := range in.GetUpdateMask().GetPaths() {
		switch p {
		case "spec":
			next.Spec = obj.GetSpec()
		case "metadata.annotations":
			next.Metadata.Annotations = maps.Clone(obj.GetMetadata().GetAnnotations())
		default:
			return nil, status.Errorf(codes.InvalidArgument, "unsupported update_mask path %q", p)
		}
	}
	next.Metadata.Version++
	v.Subscriptions[i] = next
	return &backendv1.SubscriptionsUpdateResponse{Object: proto.Clone(next).(*backendv1.Subscription)}, nil
}

func (v *V1) deleteSubscription(in *backendv1.SubscriptionsDeleteRequest) (*backendv1.SubscriptionsDeleteResponse, error) {
	i, err := v.findSubscription(in.GetId())
	if err != nil {
		return nil, err
	}
	if rv := in.GetResourceVersion(); rv != 0 && rv != v.Subscriptions[i].GetMetadata().GetVersion() {
		return nil, staleV1("delete", "Subscription", "subscription", in.GetId())
	}
	v.Subscriptions = slices.Delete(v.Subscriptions, i, i+1)
	return &backendv1.SubscriptionsDeleteResponse{}, nil
}

// clones deep-copies items, so an answer never shares a stored message.
func clones[M proto.Message](items []M) []M {
	out := make([]M, 0, len(items))
	for _, m := range items {
		out = append(out, proto.Clone(m).(M))
	}
	return out
}
