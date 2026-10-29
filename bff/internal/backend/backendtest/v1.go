package backendtest

import (
	"cmp"
	"context"
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

// V1 answers the backend's own API, ai_grid.v1 as ai-grid-provider-backend
// serves it, which is what production calls through the adapters in
// internal/backend (v1.go): AiGrid (Ping only) and Tenants on the backend's
// method paths, with the
// messages of the BFF's copy of its proto (ai_grid.backend.v1). The backend
// has no Grid service and no capabilities, so those answer Unimplemented, and
// so does every method it doesn't have.
//
// The rules are the backend's at ca83c8d (internal/servers), as far as a
// handler test needs them:
//   - metadata.version is the lock. An Update with lock and version 0 is
//     InvalidArgument; a nonzero version other than the stored one is Aborted;
//     and an update stores version + 1 (models_git.go and subscriptions_git.go
//     gitUpdate). A Delete
//     with a nonzero version other than the stored one is Aborted (gitDelete).
//   - A tenant Update or Delete without a version is InvalidArgument
//     (tenants_server.go errTenantVersionRequired), and a tenant update
//     stores version + 1.
//   - The update_mask paths are the backend's own (metadata.labels,
//     spec.domains, ...). A tenant or model path it doesn't know is
//     InvalidArgument (tenantUpdatePaths, parseModelUpdateMask).
//   - Lists of tenants and models page by offset and limit and count every
//     item in total (applyListWindow). Tenants doesn't evaluate filter.
//   - NotFound, AlreadyExists and Aborted carry the backend's messages.
//
// Left out: Keycloak's and Git's validation, and every status, which is
// served as seeded.
//
// Seed the exported fields before StartV1. Each call is handled under a lock,
// so concurrent calls are safe; read Calls and Metadata after a call returned.
type V1 struct {
	Tenants []*backendv1.Tenant
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
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.Tenants", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "List", v.listTenants),
		unary(v, "Get", v.getTenant),
		unary(v, "Create", v.createTenant),
		unary(v, "Update", v.updateTenant),
		unary(v, "Delete", v.deleteTenant),
	}}, v)
	return serve(t, srv, backend.Config{})
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

// staleV1 is the backend's Aborted answer to a stale version, "update Model \"m\": the model changed since it was read; reload and retry".
func staleV1(op, kind, noun, id string) error {
	return status.Errorf(codes.Aborted, "%s %s %q: the %s changed since it was read; reload and retry", op, kind, id, noun)
}

func (v *V1) ping(in *aigridv1.PingRequest) (*aigridv1.PingResponse, error) {
	return &aigridv1.PingResponse{Message: "pong " + in.GetName()}, nil
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

// clones deep-copies items, so an answer never shares a stored message.
func clones[M proto.Message](items []M) []M {
	out := make([]M, 0, len(items))
	for _, m := range items {
		out = append(out, proto.Clone(m).(M))
	}
	return out
}
