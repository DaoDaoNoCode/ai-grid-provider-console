package backend

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// recordingConn records one Invoke and answers with reply.
type recordingConn struct {
	method string
	req    any
	reply  proto.Message
}

func (c *recordingConn) Invoke(_ context.Context, method string, args, reply any, _ ...grpc.CallOption) error {
	c.method, c.req = method, args
	proto.Merge(reply.(proto.Message), c.reply)
	return nil
}

func (c *recordingConn) NewStream(context.Context, *grpc.StreamDesc, string, ...grpc.CallOption) (grpc.ClientStream, error) {
	panic("unused")
}

func TestV1UpdateSendsMetadataPathsAndVersion(t *testing.T) {
	conn := &recordingConn{reply: &backendv1.ClustersUpdateResponse{Object: &backendv1.ManagedCluster{
		Id: "site1", Metadata: &backendv1.Metadata{Version: 8}, Spec: &backendv1.ManagedClusterSpec{HubAcceptsClient: true},
	}}}
	resp, err := v1Clusters{conn}.UpdateManagedCluster(context.Background(), &aigridv1.UpdateManagedClusterRequest{
		Object:     &aigridv1.ManagedCluster{Name: "site1", ResourceVersion: "7", Labels: map[string]string{"ai-grid/enabled": "true"}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"labels"}},
		Lock:       true,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := &backendv1.ClustersUpdateRequest{
		Object: &backendv1.ManagedCluster{Id: "site1", Metadata: &backendv1.Metadata{
			Labels: map[string]string{"ai-grid/enabled": "true"}, Version: 7,
		}},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"metadata.labels"}},
		Lock:       true,
	}
	if conn.method != methodClustersUpdate || !proto.Equal(conn.req.(proto.Message), want) {
		t.Fatalf("sent %s %v, want %v", conn.method, conn.req, want)
	}
	if p := resp.GetObject().GetStatus().Provisioning; p == nil || *p != "" {
		t.Fatalf("provisioning %v, want set and empty", p)
	}
	if got := resp.GetObject().GetResourceVersion(); got != "8" {
		t.Fatalf("resource version %q, want 8", got)
	}
}

func TestFromV1ClusterState(t *testing.T) {
	accepted := &backendv1.ManagedClusterSpec{HubAcceptsClient: true}
	for _, tc := range []struct {
		name string
		mc   *backendv1.ManagedCluster
		want aigridv1.ManagedClusterState
	}{
		{"not accepted", &backendv1.ManagedCluster{}, aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_NOT_ACCEPTED},
		{"not joined", &backendv1.ManagedCluster{Spec: accepted}, aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_PENDING_IMPORT},
		{"available", &backendv1.ManagedCluster{Spec: accepted, Status: &backendv1.ManagedClusterStatus{Joined: true, AvailableCondition: "True"}}, aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_AVAILABLE},
		{"offline", &backendv1.ManagedCluster{Spec: accepted, Status: &backendv1.ManagedClusterStatus{Joined: true, AvailableCondition: "False"}}, aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNAVAILABLE},
		{"unknown", &backendv1.ManagedCluster{Spec: accepted, Status: &backendv1.ManagedClusterStatus{Joined: true}}, aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNKNOWN},
	} {
		if got := FromV1Cluster(tc.mc).GetStatus().GetState(); got != tc.want {
			t.Errorf("%s: state %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestV1ListTenantsForwardsPageAndFilter(t *testing.T) {
	conn := &recordingConn{reply: &backendv1.TenantsListResponse{Size: 1, Total: 3, Items: []*backendv1.Tenant{{Id: "t2"}}}}
	resp, err := v1Tenants{conn}.ListTenants(context.Background(), &aigridv1.ListTenantsRequest{Offset: proto.Int32(1), Limit: proto.Int32(1)})
	if err != nil {
		t.Fatal(err)
	}
	if want := (&backendv1.TenantsListRequest{Offset: proto.Int32(1), Limit: proto.Int32(1)}); !proto.Equal(conn.req.(proto.Message), want) {
		t.Fatalf("sent %v, want %v", conn.req, want)
	}
	if resp.Total == nil || *resp.Total != 3 || len(resp.GetTenants()) != 1 {
		t.Fatalf("got total %v and %d tenants, want 3 and 1", resp.Total, len(resp.GetTenants()))
	}

	// The backend doesn't evaluate filter yet: no total, so the handler answers 501.
	resp, err = v1Tenants{conn}.ListTenants(context.Background(), &aigridv1.ListTenantsRequest{Filter: proto.String(`this.name == "a"`)})
	if err != nil {
		t.Fatal(err)
	}
	if conn.req.(*backendv1.TenantsListRequest).Filter == nil || resp.Total != nil {
		t.Fatalf("filter not forwarded, or total %v set", resp.Total)
	}

	got, err := v1Tenants{conn}.GetTenant(context.Background(), &aigridv1.GetTenantRequest{Id: "t2"})
	if err != nil || got.GetObject().GetId() != "t2" {
		t.Fatalf("GetTenant() = %v, %v", got, err)
	}
}
