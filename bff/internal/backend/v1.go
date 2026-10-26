package backend

// Stopgap: clients for the backend's real ai_grid.v1
// Clusters and Tenants RPCs, behind the draft's ManagedClustersClient and
// TenantsClient interfaces so the API handlers are unchanged. The fake backend
// serves the draft, so Dial uses these only for a real backend.

import (
	"context"
	"strconv"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

const (
	methodClustersList   = "/ai_grid.v1.Clusters/List"
	methodClustersGet    = "/ai_grid.v1.Clusters/Get"
	methodClustersUpdate = "/ai_grid.v1.Clusters/Update"
	methodTenantsList    = "/ai_grid.v1.Tenants/List"
	methodTenantsGet     = "/ai_grid.v1.Tenants/Get"
	methodTenantsCreate  = "/ai_grid.v1.Tenants/Create"
	methodTenantsUpdate  = "/ai_grid.v1.Tenants/Update"
	methodTenantsDelete  = "/ai_grid.v1.Tenants/Delete"
)

type v1Clusters struct{ conn grpc.ClientConnInterface }

var _ aigridv1.ManagedClustersClient = v1Clusters{}

// ListManagedClusters forwards offset and limit, which the backend pages by
// (applyListWindow). Its ClustersListRequest has a filter it doesn't evaluate
// yet ("Not evaluated yet"), and its total always counts every cluster, so a
// forwarded filter would come back as the whole list presented as the
// filtered one; a filter is Unimplemented (501) instead.
func (c v1Clusters) ListManagedClusters(ctx context.Context, in *aigridv1.ListManagedClustersRequest, opts ...grpc.CallOption) (*aigridv1.ListManagedClustersResponse, error) {
	if in.Filter != nil {
		return nil, status.Error(codes.Unimplemented, "the backend's Clusters API does not evaluate filter yet")
	}
	req := &backendv1.ClustersListRequest{Offset: in.Offset, Limit: in.Limit}
	resp := &backendv1.ClustersListResponse{}
	if err := c.conn.Invoke(ctx, methodClustersList, req, resp, opts...); err != nil {
		return nil, err
	}
	out := &aigridv1.ListManagedClustersResponse{Size: resp.GetSize(), Total: resp.GetTotal()}
	for _, mc := range resp.GetItems() {
		out.Clusters = append(out.Clusters, FromV1Cluster(mc))
	}
	return out, nil
}

func (c v1Clusters) GetManagedCluster(ctx context.Context, in *aigridv1.GetManagedClusterRequest, opts ...grpc.CallOption) (*aigridv1.GetManagedClusterResponse, error) {
	resp := &backendv1.ClustersGetResponse{}
	if err := c.conn.Invoke(ctx, methodClustersGet, &backendv1.ClustersGetRequest{Id: in.GetName()}, resp, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.GetManagedClusterResponse{Object: FromV1Cluster(resp.GetObject())}, nil
}

// UpdateManagedCluster sends the draft's labels/annotations mask as the real
// metadata paths and its resource_version as metadata.version.
func (c v1Clusters) UpdateManagedCluster(ctx context.Context, in *aigridv1.UpdateManagedClusterRequest, opts ...grpc.CallOption) (*aigridv1.UpdateManagedClusterResponse, error) {
	obj := in.GetObject()
	version, err := strconv.ParseInt(obj.GetResourceVersion(), 10, 32)
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "version %q is not one this backend answered", obj.GetResourceVersion())
	}
	var paths []string
	for _, p := range in.GetUpdateMask().GetPaths() {
		paths = append(paths, "metadata."+p)
	}
	req := &backendv1.ClustersUpdateRequest{
		Object: &backendv1.ManagedCluster{
			Id:       obj.GetName(),
			Metadata: &backendv1.Metadata{Labels: obj.GetLabels(), Annotations: obj.GetAnnotations(), Version: int32(version)},
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: paths},
		Lock:       in.GetLock(),
	}
	resp := &backendv1.ClustersUpdateResponse{}
	if err := c.conn.Invoke(ctx, methodClustersUpdate, req, resp, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.UpdateManagedClusterResponse{Object: FromV1Cluster(resp.GetObject())}, nil
}

// FromV1Cluster maps a real ManagedCluster onto the draft. The real status has
// only the Joined and Available conditions, so the state is derived from them
// in the fake's order (fakebackend/state.go); import progress, claims and
// capacity are not available. Provisioning is always set, so the console
// reads it instead of the ai-grid/provisioned label.
func FromV1Cluster(mc *backendv1.ManagedCluster) *aigridv1.ManagedCluster {
	meta := mc.GetMetadata()
	st := mc.GetStatus()
	state := aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNKNOWN
	switch {
	case meta.GetDeletionTimestamp() != nil:
		state = aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_DETACHING
	case !mc.GetSpec().GetHubAcceptsClient():
		state = aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_NOT_ACCEPTED
	case !st.GetJoined():
		state = aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_PENDING_IMPORT
	case st.GetAvailableCondition() == "True":
		state = aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_AVAILABLE
	case st.GetAvailableCondition() == "False":
		state = aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNAVAILABLE
	}
	return &aigridv1.ManagedCluster{
		Name:              mc.GetId(),
		Labels:            meta.GetLabels(),
		Annotations:       meta.GetAnnotations(),
		HubAcceptsClient:  mc.GetSpec().GetHubAcceptsClient(),
		ResourceVersion:   strconv.Itoa(int(meta.GetVersion())),
		CreationTimestamp: meta.GetCreationTimestamp(),
		DeletionTimestamp: meta.GetDeletionTimestamp(),
		Status:            &aigridv1.ManagedClusterStatus{State: state, Provisioning: proto.String(st.GetProvisioning())},
	}
}

type v1Tenants struct{ conn grpc.ClientConnInterface }

var _ aigridv1.TenantsClient = v1Tenants{}

// ListTenants forwards offset, limit and filter. The backend pages but
// doesn't evaluate filter yet, so a filtered answer carries no total and the
// handler refuses it (requireTotal).
func (c v1Tenants) ListTenants(ctx context.Context, in *aigridv1.ListTenantsRequest, opts ...grpc.CallOption) (*aigridv1.ListTenantsResponse, error) {
	req := &backendv1.TenantsListRequest{Offset: in.Offset, Limit: in.Limit, Filter: in.Filter}
	resp := &backendv1.TenantsListResponse{}
	if err := c.conn.Invoke(ctx, methodTenantsList, req, resp, opts...); err != nil {
		return nil, err
	}
	out := &aigridv1.ListTenantsResponse{Size: resp.GetSize()}
	if in.Filter == nil {
		total := resp.GetTotal()
		out.Total = &total
	}
	for _, t := range resp.GetItems() {
		out.Tenants = append(out.Tenants, FromV1Tenant(t))
	}
	return out, nil
}

// GetTenant reads one tenant.
func (c v1Tenants) GetTenant(ctx context.Context, in *aigridv1.GetTenantRequest, opts ...grpc.CallOption) (*aigridv1.GetTenantResponse, error) {
	resp := &backendv1.TenantsGetResponse{}
	if err := c.conn.Invoke(ctx, methodTenantsGet, &backendv1.TenantsGetRequest{Id: in.GetId()}, resp, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.GetTenantResponse{Object: FromV1Tenant(resp.GetObject())}, nil
}

// CreateTenant sends the name and domains, the only fields the backend's
// Tenant has. A request that sets a field it lacks is Unimplemented, not
// dropped. The backend sets the Keycloak alias to the name.
func (c v1Tenants) CreateTenant(ctx context.Context, in *aigridv1.CreateTenantRequest, opts ...grpc.CallOption) (*aigridv1.CreateTenantResponse, error) {
	obj := in.GetObject()
	var unsupported []string
	if obj.GetAlias() != "" && obj.GetAlias() != obj.GetName() {
		unsupported = append(unsupported, "alias")
	}
	if obj.GetDescription() != "" {
		unsupported = append(unsupported, "description")
	}
	if obj.Enabled != nil && !obj.GetEnabled() {
		unsupported = append(unsupported, "enabled")
	}
	if len(obj.GetAttributes()) > 0 {
		unsupported = append(unsupported, "attributes")
	}
	if obj.GetIdentityProvider() != nil {
		unsupported = append(unsupported, "identityProvider")
	}
	if err := notInBackend(unsupported); err != nil {
		return nil, err
	}
	req := &backendv1.TenantsCreateRequest{Object: &backendv1.Tenant{
		Metadata: &backendv1.Metadata{Name: obj.GetName()},
		Spec:     &backendv1.TenantSpec{Domains: obj.GetDomains()},
	}}
	resp := &backendv1.TenantsCreateResponse{}
	if err := c.conn.Invoke(ctx, methodTenantsCreate, req, resp, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.CreateTenantResponse{Object: FromV1Tenant(resp.GetObject())}, nil
}

// tenantPaths maps the draft's mask paths onto the backend's; the others
// name fields the backend's Tenant doesn't have.
var tenantPaths = map[string]string{"name": "metadata.name", "domains": "spec.domains"}

// UpdateTenant sends the draft's name and domains paths as the backend's, and
// the If-Match version as metadata.version with lock. The backend (PR 16)
// requires a version: every tenant reads as 1 or more, and 0 is
// InvalidArgument (422). Description, enabled and attributes pass when they
// hold what a read gives back (empty, true, none), as on create; other values,
// and any alias (the backend can't say which one Keycloak keeps after a
// rename), are Unimplemented. When only those no-op fields are left (an empty
// mask would make the backend update the name and domains), the mask names
// only id, which the backend answers with the stored tenant after checking
// the version, writing nothing.
func (c v1Tenants) UpdateTenant(ctx context.Context, in *aigridv1.UpdateTenantRequest, opts ...grpc.CallOption) (*aigridv1.UpdateTenantResponse, error) {
	obj := in.GetObject()
	version, err := tenantVersion(obj.GetResourceVersion())
	if err != nil {
		return nil, err
	}
	var paths, unsupported []string
	for _, p := range in.GetUpdateMask().GetPaths() {
		if real, ok := tenantPaths[p]; ok {
			paths = append(paths, real)
		} else if !readBackValue(p, obj) {
			unsupported = append(unsupported, p)
		}
	}
	if err := notInBackend(unsupported); err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		paths = []string{"id"}
	}
	req := &backendv1.TenantsUpdateRequest{
		Object: &backendv1.Tenant{
			Id:       obj.GetId(),
			Metadata: &backendv1.Metadata{Name: obj.GetName(), Version: version},
			Spec:     &backendv1.TenantSpec{Domains: obj.GetDomains()},
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: paths},
		Lock:       true,
	}
	resp := &backendv1.TenantsUpdateResponse{}
	if err := c.conn.Invoke(ctx, methodTenantsUpdate, req, resp, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.UpdateTenantResponse{Object: FromV1Tenant(resp.GetObject())}, nil
}

// DeleteTenant sends the If-Match version, which the backend (PR 16) checks;
// it answers 0 with InvalidArgument (422).
func (c v1Tenants) DeleteTenant(ctx context.Context, in *aigridv1.DeleteTenantRequest, opts ...grpc.CallOption) (*aigridv1.DeleteTenantResponse, error) {
	version, err := tenantVersion(in.GetResourceVersion())
	if err != nil {
		return nil, err
	}
	if err := c.conn.Invoke(ctx, methodTenantsDelete, &backendv1.TenantsDeleteRequest{Id: in.GetId(), Version: version}, &backendv1.TenantsDeleteResponse{}, opts...); err != nil {
		return nil, err
	}
	return &aigridv1.DeleteTenantResponse{}, nil
}

// tenantVersion parses an If-Match version into the backend's metadata.version.
// A negative one is InvalidArgument: the backend never answers one.
func tenantVersion(rv string) (int32, error) {
	v, err := strconv.ParseInt(rv, 10, 32)
	if err != nil {
		return 0, status.Errorf(codes.FailedPrecondition, "version %q is not one this backend answered", rv)
	}
	if v < 0 {
		return 0, status.Errorf(codes.InvalidArgument, "version %q is negative", rv)
	}
	return int32(v), nil
}

// readBackValue reports whether path p, which the backend's Tenant lacks,
// holds what a read gives back: no description, enabled, no attributes.
func readBackValue(p string, obj *aigridv1.Tenant) bool {
	switch p {
	case "description":
		return obj.GetDescription() == ""
	case "enabled":
		return obj.GetEnabled()
	case "attributes":
		return len(obj.GetAttributes()) == 0
	}
	return false
}

// notInBackend refuses a request that sets fields the backend's Tenant lacks.
func notInBackend(fields []string) error {
	if len(fields) == 0 {
		return nil
	}
	return status.Errorf(codes.Unimplemented, "the backend's Tenants API has no %s", strings.Join(fields, ", "))
}

// FromV1Tenant maps a real Tenant (id, name, domains, version, creation time)
// onto the draft.
func FromV1Tenant(t *backendv1.Tenant) *aigridv1.Tenant {
	return &aigridv1.Tenant{
		Id:              t.GetId(),
		Name:            t.GetMetadata().GetName(),
		Domains:         t.GetSpec().GetDomains(),
		ResourceVersion: strconv.Itoa(int(t.GetMetadata().GetVersion())),
		CreateTime:      t.GetMetadata().GetCreationTimestamp(),
	}
}
