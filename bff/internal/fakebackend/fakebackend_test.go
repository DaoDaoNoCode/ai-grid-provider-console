package fakebackend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	healthv1 "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// repoFixtures is the directory the console ships; the test proves it loads
// and that every cluster carries the labels ACM sets on a real hub.
const repoFixtures = "../../../mock/fixtures"

func TestRepoFixturesLoad(t *testing.T) {
	fx, err := Load(repoFixtures)
	if err != nil {
		t.Fatal(err)
	}
	if len(fx.Clusters) < 2 {
		t.Fatalf("expected several clusters, got %d", len(fx.Clusters))
	}
	for _, c := range fx.Clusters {
		for _, want := range []string{"name", "cloud", "vendor", "openshiftVersion", "openshiftVersion-major-minor", "clusterID", "cluster.open-cluster-management.io/clusterset"} {
			if _, ok := c.GetLabels()[want]; !ok {
				t.Errorf("cluster %s lacks the ACM label %q", c.GetName(), want)
			}
		}
		if c.GetLabels()["name"] != c.GetName() {
			t.Errorf("cluster %s: ACM sets label name=<cluster name>", c.GetName())
		}
	}
	if _, err := New(fx, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
}

func TestLoadRejectsBadFixtures(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("managedclusters.json", `{"clusters": [{"name": "a", "nope": 1}]}`)
	if _, err := Load(dir); err == nil || !strings.Contains(err.Error(), "cluster 0") {
		t.Errorf("unknown proto field should fail with position, got %v", err)
	}
	write("managedclusters.json", `{"clusters": [{"name": "a"}, {"name": "a"}]}`)
	fx, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := New(fx, nil); err == nil {
		t.Error("duplicate cluster names should fail")
	}
	write("managedclusters.json", `{"clusters": []}`)
	write("tenants.json", `{"tenants": [], "unavailable": "x"}`)
	if _, err := Load(dir); err == nil {
		t.Error("tenants and unavailable together should fail")
	}
	write("tenants.json", `{"unavailable": "request Keycloak token: dial tcp: lookup keycloak.ai-grid.svc: no such host"}`)
	write("settings.json", `{"latency": "15ms"}`)
	fx, err = Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if fx.Latency.Duration() != 15*time.Millisecond || fx.TenantsUnavailable == "" {
		t.Errorf("fixtures = %+v", fx)
	}
}

// TestLoadRequiresTheDirectory: a mistyped --fixtures path must not start an
// empty backend that allows everyone; an empty directory, by contrast, is a
// valid, deliberately empty backend.
func TestLoadRequiresTheDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "fixturez")
	if _, err := Load(missing); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("nonexistent directory should fail with ErrNotExist, got %v", err)
	}
	file := filepath.Join(t.TempDir(), "fixtures.json")
	if err := os.WriteFile(file, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(file); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("a file is not a fixtures directory, got %v", err)
	}
	fx, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("an empty directory is a valid empty backend, got %v", err)
	}
	if len(fx.Clusters) != 0 || fx.Tenants != nil || fx.TenantsUnavailable != "" || !fx.Access.DefaultAllowed || fx.Latency.Duration() != 0 {
		t.Errorf("empty directory should load defaults, got %+v", fx)
	}
}

// authed is the metadata the BFF forwards with every RPC, so direct calls
// into the Server look like calls that came through the BFF.
func authed(ctx context.Context) context.Context {
	return metadata.NewIncomingContext(ctx, metadata.Pairs("authorization", "Bearer dev-token", "x-forwarded-user", "dev-user"))
}

// TestNewCopiesTheFixtures: New must not keep the caller's pointers, or a
// later change to fx would alter the served state without the server's lock.
func TestNewCopiesTheFixtures(t *testing.T) {
	fx := &Fixtures{
		Clusters: []*aigridv1.ManagedCluster{{Name: "a", Labels: map[string]string{"name": "a"}}},
		Tenants:  []*aigridv1.Tenant{{Id: "1", Name: "t-corp", Domains: []string{"t.example.com"}}},
	}
	s, err := New(fx, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	fx.Clusters[0].Labels["name"] = "changed"
	fx.Clusters[0].HubAcceptsClient = true
	fx.Tenants[0].Name = "changed"
	fx.Tenants[0].Domains[0] = "changed.example.com"

	ctx := authed(context.Background())
	clusters, err := s.ListManagedClusters(ctx, &aigridv1.ListManagedClustersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if c := clusters.GetClusters()[0]; c.GetLabels()["name"] != "a" || c.GetHubAcceptsClient() {
		t.Errorf("cluster state followed a fixture change made after New: %v", c)
	}
	tenants, err := s.ListTenants(ctx, &aigridv1.ListTenantsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if tn := tenants.GetTenants()[0]; tn.GetName() != "t-corp" || tn.GetDomains()[0] != "t.example.com" {
		t.Errorf("tenant state followed a fixture change made after New: %v", tn)
	}
}

func dial(t *testing.T, s *Server) *grpc.ClientConn {
	t.Helper()
	srv := grpc.NewServer()
	s.Register(srv)
	return dialServer(t, srv)
}

// dialServer serves srv over bufconn and returns a client connection to it.
func dialServer(t *testing.T, srv *grpc.Server) *grpc.ClientConn {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	go func() { _ = srv.Serve(lis) }()
	conn, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(); srv.Stop() })
	return conn
}

func TestServerBehavesLikeTheBackend(t *testing.T) {
	fx := &Fixtures{
		Clusters: []*aigridv1.ManagedCluster{
			{Name: "zeta", Labels: map[string]string{"name": "zeta"}, HubAcceptsClient: true},
			{Name: "alpha", Labels: map[string]string{"name": "alpha"}, HubAcceptsClient: true},
		},
		Tenants: []*aigridv1.Tenant{{Id: "1", Name: "b-corp"}, {Id: "2", Name: "a-corp", Domains: []string{"a.example.com"}}},
	}
	s, err := New(fx, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	conn := dial(t, s)
	ctx := metadata.AppendToOutgoingContext(context.Background(), "x-forwarded-user", "alice", "authorization", "Bearer t")

	pong, err := aigridv1.NewAiGridClient(conn).Ping(ctx, &aigridv1.PingRequest{Name: "bff"})
	if err != nil || pong.GetMessage() != "Hello, bff!" {
		t.Fatalf("Ping = %v, %v", pong, err)
	}
	clusters, err := aigridv1.NewManagedClustersClient(conn).ListManagedClusters(ctx, &aigridv1.ListManagedClustersRequest{})
	if err != nil || len(clusters.GetClusters()) != 2 || clusters.GetClusters()[0].GetName() != "alpha" {
		t.Fatalf("clusters should be sorted by name: %v, %v", clusters, err)
	}
	// Over gRPC the client always gets its own decoded objects, so the copy
	// guarantee is checked on the Server directly: mutate a response, list again.
	direct, err := s.ListManagedClusters(authed(context.Background()), &aigridv1.ListManagedClustersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	direct.GetClusters()[0].Labels["mutated"] = "yes"
	direct.GetClusters()[0].Name = "mutated"
	again, err := s.ListManagedClusters(authed(context.Background()), &aigridv1.ListManagedClustersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if c := again.GetClusters()[0]; c.GetName() != "alpha" || c.GetLabels()["mutated"] != "" {
		t.Errorf("responses must be copies of the server state, got %v", c)
	}
	tenants, err := aigridv1.NewTenantsClient(conn).ListTenants(ctx, &aigridv1.ListTenantsRequest{})
	if err != nil || len(tenants.GetTenants()) != 2 || tenants.GetTenants()[0].GetName() != "a-corp" {
		t.Fatalf("tenants should be sorted by name: %v, %v", tenants, err)
	}

	s.TenantsErr = status.Error(codes.Unknown, "request Keycloak token: connection refused")
	if _, err := aigridv1.NewTenantsClient(conn).ListTenants(ctx, &aigridv1.ListTenantsRequest{}); status.Code(err) != codes.Unknown {
		t.Errorf("tenants error should pass through with its code, got %v", err)
	}
}

// TestShutdownClosesOpenStreams: a health Watch never ends on its own, so an
// unbounded GracefulStop would keep Serve (and the process) alive forever.
func TestShutdownClosesOpenStreams(t *testing.T) {
	s, err := New(&Fixtures{}, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	s.stopTimeout = 100 * time.Millisecond
	lis := bufconn.Listen(1 << 20)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- s.serve(ctx, lis) }()
	conn, err := grpc.NewClient("passthrough:///bufconn", grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	watch, err := healthv1.NewHealthClient(conn).Watch(context.Background(), &healthv1.HealthCheckRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if first, err := watch.Recv(); err != nil || first.GetStatus() != healthv1.HealthCheckResponse_SERVING {
		t.Fatalf("health Watch = %v, %v", first, err)
	}

	cancel()
	select {
	case err := <-served:
		if err != nil {
			t.Errorf("Serve returned %v after cancellation", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return while a health Watch stream was open: shutdown must be bounded")
	}
	if _, err := watch.Recv(); err == nil {
		t.Error("the Watch stream should be closed by the forced stop")
	}
}

func TestLatencyHonoursCancellation(t *testing.T) {
	s, _ := New(&Fixtures{Latency: Duration{d: time.Second}}, slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := s.Ping(ctx, &aigridv1.PingRequest{})
	if status.Code(err) != codes.DeadlineExceeded {
		t.Errorf("expected DeadlineExceeded, got %v", err)
	}
}

func TestHubAccessReview(t *testing.T) {
	h := NewHub(Access{DefaultAllowed: true, DeniedTokens: []string{"viewer"}, RejectedTokens: []string{"expired"}}, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(h.Handler())
	defer srv.Close()
	review := func(token string) (int, bool) {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
			strings.NewReader(`{"apiVersion":"authorization.k8s.io/v1","kind":"SelfSubjectAccessReview","spec":{"resourceAttributes":{"group":"cluster.open-cluster-management.io","resource":"managedclusters","verb":"patch"}}}`))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		var out struct {
			Status struct{ Allowed bool } `json:"status"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out.Status.Allowed
	}
	if code, allowed := review("admin-token"); code != http.StatusCreated || !allowed {
		t.Errorf("admin: %d %v", code, allowed)
	}
	if code, allowed := review("viewer"); code != http.StatusCreated || allowed {
		t.Errorf("viewer: %d %v", code, allowed)
	}
	if code, _ := review("expired"); code != http.StatusUnauthorized {
		t.Errorf("expired: %d", code)
	}
	if code, _ := review(""); code != http.StatusUnauthorized {
		t.Errorf("no token: %d", code)
	}
	resp, err := http.Get(srv.URL + "/api/v1/namespaces")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("other paths: %d", resp.StatusCode)
	}
}

// intentionallyUnimplemented lists the methods of the draft proto the fake
// answers Unimplemented on purpose, keyed by full method name, with the reason.
// TestFakeImplementsEveryProtoMethod fails on an Unimplemented answer from any
// method not listed here, and on a listed method that answers anything else
// (a stale entry), so this list is exactly the set of stubs at any time. When
// an area implements a method, its entry goes.
var intentionallyUnimplemented = map[string]string{
	"/ai_grid.v1.AiGrid/GetCurrentUser": "GetCurrentUser not implemented yet; the BFF derives isProviderAdmin itself",

	"/ai_grid.v1.ManagedClusters/GetManagedCluster":    "implemented in the clusters area",
	"/ai_grid.v1.ManagedClusters/UpdateManagedCluster": "implemented in the clusters area",

	"/ai_grid.v1.Tenants/GetTenant":    "implemented in the tenants area",
	"/ai_grid.v1.Tenants/CreateTenant": "implemented in the tenants area",
	"/ai_grid.v1.Tenants/UpdateTenant": "implemented in the tenants area",
	"/ai_grid.v1.Tenants/DeleteTenant": "implemented in the tenants area",

	"/ai_grid.v1.Grid/GetOverview": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Grid/GetNetwork":  "placeholder until agreed with the backend team, see mock/README.md",

	"/ai_grid.v1.Models/ListModels":  "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Models/GetModel":    "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Models/CreateModel": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Models/UpdateModel": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Models/DeleteModel": "placeholder until agreed with the backend team, see mock/README.md",

	"/ai_grid.v1.CatalogItems/ListCatalogItems":  "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.CatalogItems/GetCatalogItem":    "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.CatalogItems/CreateCatalogItem": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.CatalogItems/UpdateCatalogItem": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.CatalogItems/DeleteCatalogItem": "placeholder until agreed with the backend team, see mock/README.md",

	"/ai_grid.v1.Subscriptions/ListSubscriptions":  "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Subscriptions/GetSubscription":    "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Subscriptions/CreateSubscription": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Subscriptions/UpdateSubscription": "placeholder until agreed with the backend team, see mock/README.md",
	"/ai_grid.v1.Subscriptions/DeleteSubscription": "placeholder until agreed with the backend team, see mock/README.md",
}

// TestFakeImplementsEveryProtoMethod fails when the draft proto gains a
// service or a method the fake does not implement: the signal to extend the
// fake (or to list the method in intentionallyUnimplemented with a reason) the
// same day the proto changes. Registration alone proves nothing, because the
// embedded Unimplemented*Server structs register every method in the generated
// ServiceDesc, so the test calls each method and requires an answer other than
// Unimplemented. It also fails when a listed method starts answering, so the
// allowlist cannot go stale.
func TestFakeImplementsEveryProtoMethod(t *testing.T) {
	s, err := New(&Fixtures{}, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer()
	s.Register(srv)
	missing, called := unimplementedMethods(t, srv)
	stubs := map[string]bool{}
	for _, m := range missing {
		stubs[m] = true
		if _, listed := intentionallyUnimplemented[m]; !listed {
			t.Errorf("the fake does not implement %s; implement it, or list it in intentionallyUnimplemented with the reason", m)
		}
	}
	methods := map[string]bool{}
	for _, m := range called {
		methods[m] = true
	}
	for m, reason := range intentionallyUnimplemented {
		switch {
		case !methods[m]:
			t.Errorf("intentionallyUnimplemented lists %s, which is not a method of the draft proto", m)
		case !stubs[m]:
			t.Errorf("intentionallyUnimplemented lists %s (%q) but the fake now answers it: remove the stale entry", m, reason)
		}
	}
}

// draftMethods is every method of every service in package ai_grid.v1 linked
// into the binary (all files of the draft proto, not just ai_grid.proto),
// sorted by full name so failures read the same every run.
func draftMethods(t *testing.T) []protoreflect.MethodDescriptor {
	t.Helper()
	var methods []protoreflect.MethodDescriptor
	protoregistry.GlobalFiles.RangeFilesByPackage("ai_grid.v1", func(file protoreflect.FileDescriptor) bool {
		for i := 0; i < file.Services().Len(); i++ {
			svc := file.Services().Get(i)
			for j := 0; j < svc.Methods().Len(); j++ {
				methods = append(methods, svc.Methods().Get(j))
			}
		}
		return true
	})
	slices.SortFunc(methods, func(a, b protoreflect.MethodDescriptor) int {
		return strings.Compare(string(a.FullName()), string(b.FullName()))
	})
	if len(methods) == 0 {
		t.Fatal("no ai_grid.v1 services are linked into the test binary")
	}
	return methods
}

// methodPath is the gRPC path of a method, "/ai_grid.v1.AiGrid/Ping".
func methodPath(m protoreflect.MethodDescriptor) string {
	return fmt.Sprintf("/%s/%s", m.Parent().FullName(), m.Name())
}

// unimplementedMethods serves srv over bufconn, calls every method of every
// service in the draft proto with an empty request, and returns the full
// names of the methods with no handler, then every method it called. A method
// has no handler when it answers Unimplemented, which an unregistered service
// does too. Each call gets its own deadline; an answer that can come from the
// client side (DeadlineExceeded, Unavailable, Canceled) means the probe itself
// failed and nothing is known about the method, so it fails the test rather
// than count as a stub. Any other answer, such as InvalidArgument or NotFound
// for the empty request, means a handler ran.
func unimplementedMethods(t *testing.T, srv *grpc.Server) (missing, called []string) {
	t.Helper()
	conn := dialServer(t, srv)
	for _, m := range draftMethods(t) {
		full := methodPath(m)
		if m.IsStreamingClient() || m.IsStreamingServer() {
			t.Fatalf("%s is a streaming method; extend unimplementedMethods to call it", full)
		}
		called = append(called, full)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer test-token", "x-forwarded-user", "test-user")
		err := conn.Invoke(ctx, full, dynamicpb.NewMessage(m.Input()), dynamicpb.NewMessage(m.Output()))
		cancel()
		switch code := status.Code(err); code {
		case codes.Unimplemented:
			missing = append(missing, full)
		case codes.DeadlineExceeded, codes.Unavailable, codes.Canceled:
			t.Errorf("probe of %s failed with %s: the server did not answer, so nothing is known about this method", full, code)
		}
	}
	return missing, called
}

// TestUnimplementedMethodsCatchesStubs proves the guard bites: a server built
// only from the generated stubs registers every service and method of the
// draft, and the check still reports every method as missing.
func TestUnimplementedMethodsCatchesStubs(t *testing.T) {
	srv := grpc.NewServer()
	aigridv1.RegisterAiGridServer(srv, aigridv1.UnimplementedAiGridServer{})
	aigridv1.RegisterManagedClustersServer(srv, aigridv1.UnimplementedManagedClustersServer{})
	aigridv1.RegisterTenantsServer(srv, aigridv1.UnimplementedTenantsServer{})
	aigridv1.RegisterGridServer(srv, aigridv1.UnimplementedGridServer{})
	aigridv1.RegisterModelsServer(srv, aigridv1.UnimplementedModelsServer{})
	aigridv1.RegisterCatalogItemsServer(srv, aigridv1.UnimplementedCatalogItemsServer{})
	aigridv1.RegisterSubscriptionsServer(srv, aigridv1.UnimplementedSubscriptionsServer{})
	missing, called := unimplementedMethods(t, srv)
	if len(called) == 0 || !slices.Equal(missing, called) {
		t.Errorf("stub-only server: got missing %v, want every method %v", missing, called)
	}
}
