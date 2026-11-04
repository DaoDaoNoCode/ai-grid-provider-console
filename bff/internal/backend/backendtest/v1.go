package backendtest

import (
	"context"
	"slices"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// V1 answers the backend's own API, ai_grid.v1 as ai-grid-provider-backend
// serves it, as far as the BFF calls it over gRPC: AiGrid/Ping, which /readyz
// sends. The backend has no capabilities, so those answer Unimplemented, and so
// does every other method: the pages call the backend's other RPCs over
// Connect, through the relay, not through this client.
//
// Each call is handled under a lock, so concurrent calls are safe; read Calls
// and Metadata after a call returned.
type V1 struct {
	// Err makes every call fail with this status.
	Err error

	mu       sync.Mutex
	calls    []string
	metadata metadata.MD
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
// the way production dials the real backend. Both are stopped when the test
// ends.
func StartV1(t *testing.T, v *V1) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	srv.RegisterService(&grpc.ServiceDesc{ServiceName: "ai_grid.v1.AiGrid", HandlerType: (*any)(nil), Methods: []grpc.MethodDesc{
		unary(v, "Ping", v.ping),
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

// ping is the backend's AiGrid/Ping; the draft's PingRequest and
// PingResponse are its AiGridPingRequest and AiGridPingResponse on the wire
// (bff/internal/protodrift checks that they stay so).
func (v *V1) ping(in *aigridv1.PingRequest) (*aigridv1.PingResponse, error) {
	return &aigridv1.PingResponse{Message: "pong " + in.GetName()}, nil
}
