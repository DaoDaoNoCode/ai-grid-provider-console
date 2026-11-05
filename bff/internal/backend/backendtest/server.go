// Package backendtest runs an in-memory ai-grid-provider-backend for handler tests.
package backendtest

import (
	"context"
	"net"
	"slices"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// Fake answers what the BFF calls over gRPC on ai-grid-provider-backend: its
// gRPC health service, grpc.health.v1.Health/Check, which /readyz sends, as the
// backend's grpchealth checker answers it for the empty service name. Every
// other method answers Unimplemented: the pages call the backend's own RPCs
// over Connect, through the relay, not through this client.
//
// Each call is handled under a lock, so concurrent calls are safe; read Calls
// after a call returned.
type Fake struct {
	healthpb.UnimplementedHealthServer

	// Err makes every call fail with this status.
	Err error
	// NotServing makes Check answer NOT_SERVING instead of SERVING.
	NotServing bool

	mu    sync.Mutex
	calls []string
}

// Calls returns the methods reached, as full method paths, in order.
func (f *Fake) Calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.calls)
}

// Check implements the gRPC health service: serving, unless NotServing is set.
func (f *Fake) Check(ctx context.Context, _ *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	method, _ := grpc.Method(ctx)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, method)
	if f.Err != nil {
		return nil, f.Err
	}
	if f.NotServing {
		return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_NOT_SERVING}, nil
	}
	return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}, nil
}

// Status is a shorthand for a gRPC error.
func Status(code codes.Code, msg string) error { return status.Error(code, msg) }

// Start serves the fake over an in-memory connection and returns a client
// dialed the way production dials the backend. Both are stopped when the test
// ends.
func Start(t *testing.T, fake *Fake) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	healthpb.RegisterHealthServer(srv, fake)
	lis := bufconn.Listen(1 << 20)
	go func() { _ = srv.Serve(lis) }()

	cfg := backend.Config{Address: "passthrough:///bufconn", Insecure: true}
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
