// Package backendtest runs an in-memory ai-grid-backend for handler tests.
package backendtest

import (
	"context"
	"net"
	"slices"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// Fake answers the console's draft API, as the console's fake backend serves
// it (`make run-fake`), from fixed data; CatalogItems and the draft-only
// methods it has no data for answer Unimplemented. Set Err to make every
// RPC fail with that status, or Errs to fail one RPC by method name
// ("UpdateManagedCluster"), so a read can succeed and the write that follows
// it fail. Calls lists the methods reached, in order, and Metadata records the
// incoming metadata of the last call so tests can assert on identity
// forwarding.
// Capabilities is what GetHubCapabilities answers, Unimplemented when nil
// like the backend.
//
// Each RPC runs under a lock, so concurrent calls are safe. A test reads the
// recorded fields after its call returned: the answer orders them.
type Fake struct {
	aigridv1.UnimplementedAiGridServer
	aigridv1.UnimplementedModelsServer
	aigridv1.UnimplementedCatalogItemsServer

	Err      error
	Errs     map[string]error
	Calls    []string
	Metadata metadata.MD

	Capabilities *aigridv1.HubCapabilities

	mu sync.Mutex
}

// begin records the call and returns the injected error for it, if any.
func (f *Fake) begin(ctx context.Context, method string) error {
	md, _ := metadata.FromIncomingContext(ctx)
	f.Metadata = md
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

// Status is a shorthand for a gRPC error.
func Status(code codes.Code, msg string) error { return status.Error(code, msg) }

// Start serves the fake over an in-memory connection and returns a client
// dialed to it, as `make run-fake` dials the fake backend. Both are stopped
// when the test ends. StartV1 serves the backend's own API, which production
// calls.
func Start(t *testing.T, fake *Fake) *backend.Client {
	t.Helper()
	srv := grpc.NewServer()
	aigridv1.RegisterAiGridServer(srv, fake)
	aigridv1.RegisterModelsServer(srv, fake)
	aigridv1.RegisterCatalogItemsServer(srv, fake)
	return serve(t, srv, backend.Config{})
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
