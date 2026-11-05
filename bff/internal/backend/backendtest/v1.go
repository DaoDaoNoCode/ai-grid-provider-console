package backendtest

import (
	"context"
	"slices"
	"sync"
	"testing"

	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// V1 answers what the BFF calls over gRPC on ai-grid-provider-backend: its
// gRPC health service, grpc.health.v1.Health/Check, which /readyz sends.
// Every other method answers Unimplemented: the pages call the backend's own
// RPCs over Connect, through the relay, not through this client.
//
// Each call is handled under a lock, so concurrent calls are safe; read Calls
// and Metadata after a call returned.
type V1 struct {
	healthpb.UnimplementedHealthServer

	// Err makes every call fail with this status.
	Err error
	// NotServing makes Check answer NOT_SERVING instead of SERVING.
	NotServing bool

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

// Check answers as the backend's grpchealth checker does for the empty
// service name: serving, unless NotServing is set.
func (v *V1) Check(ctx context.Context, _ *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	method, _ := grpc.Method(ctx)
	md, _ := metadata.FromIncomingContext(ctx)
	v.mu.Lock()
	defer v.mu.Unlock()
	v.calls, v.metadata = append(v.calls, method), md
	if v.Err != nil {
		return nil, v.Err
	}
	if v.NotServing {
		return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_NOT_SERVING}, nil
	}
	return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}, nil
}

// StartV1 serves v over an in-memory connection and returns a client dialed
// the way production dials the real backend. Both are stopped when the test
// ends.
func StartV1(t *testing.T, v *V1) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	healthpb.RegisterHealthServer(srv, v)
	return serve(t, srv, backend.Config{})
}
