package backend

// Stopgap: clients for the backend's real ai_grid.v1
// Clusters and Tenants RPCs, behind the draft's ManagedClustersClient and
// TenantsClient interfaces so the API handlers are unchanged. The fake backend
// serves the draft, so Dial uses these only for a real backend.

import (
	"context"
	"strconv"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

const (
	methodClustersList   = "/ai_grid.v1.Clusters/List"
	methodClustersGet    = "/ai_grid.v1.Clusters/Get"
	methodClustersUpdate = "/ai_grid.v1.Clusters/Update"
	methodTenantsList    = "/ai_grid.v1.Tenants/List"
)

type v1Clusters struct{ conn grpc.ClientConnInterface }

var _ aigridv1.ManagedClustersClient = v1Clusters{}

func (c v1Clusters) ListManagedClusters(ctx context.Context, _ *aigridv1.ListManagedClustersRequest, opts ...grpc.CallOption) (*aigridv1.ListManagedClustersResponse, error) {
	resp := &backendv1.ClustersListResponse{}
	if err := c.conn.Invoke(ctx, methodClustersList, &backendv1.ClustersListRequest{}, resp, opts...); err != nil {
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
// capacity are not available.
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
		Status:            &aigridv1.ManagedClusterStatus{State: state},
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

// GetTenant has no RPC yet; it reads the list, as the clusters handler does.
func (c v1Tenants) GetTenant(ctx context.Context, in *aigridv1.GetTenantRequest, opts ...grpc.CallOption) (*aigridv1.GetTenantResponse, error) {
	list, err := c.ListTenants(ctx, &aigridv1.ListTenantsRequest{}, opts...)
	if err != nil {
		return nil, err
	}
	for _, t := range list.GetTenants() {
		if t.GetId() == in.GetId() {
			return &aigridv1.GetTenantResponse{Object: t}, nil
		}
	}
	return nil, status.Errorf(codes.NotFound, "object with identifier '%s' not found", in.GetId())
}

func (v1Tenants) CreateTenant(context.Context, *aigridv1.CreateTenantRequest, ...grpc.CallOption) (*aigridv1.CreateTenantResponse, error) {
	return nil, status.Error(codes.Unimplemented, "Tenants/Create is not in the backend")
}

func (v1Tenants) UpdateTenant(context.Context, *aigridv1.UpdateTenantRequest, ...grpc.CallOption) (*aigridv1.UpdateTenantResponse, error) {
	return nil, status.Error(codes.Unimplemented, "Tenants/Update is not in the backend")
}

func (v1Tenants) DeleteTenant(context.Context, *aigridv1.DeleteTenantRequest, ...grpc.CallOption) (*aigridv1.DeleteTenantResponse, error) {
	return nil, status.Error(codes.Unimplemented, "Tenants/Delete is not in the backend")
}

// FromV1Tenant maps a real Tenant (id, name, domains) onto the draft.
func FromV1Tenant(t *backendv1.Tenant) *aigridv1.Tenant {
	return &aigridv1.Tenant{
		Id:         t.GetId(),
		Name:       t.GetMetadata().GetName(),
		Domains:    t.GetSpec().GetDomains(),
		CreateTime: t.GetMetadata().GetCreationTimestamp(),
	}
}
