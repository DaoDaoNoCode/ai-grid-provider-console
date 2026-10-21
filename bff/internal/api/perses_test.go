package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/perses"
)

// persesUpstream stands in for the hub's Perses and records the Authorization it got.
func persesUpstream(t *testing.T) (*perses.Relay, *[]string) {
	t.Helper()
	var auth []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = append(auth, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(srv.Close)
	// A loopback http:// target, as for a port-forward in development.
	relay, err := perses.New(perses.Config{URL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	return relay, &auth
}

func TestPersesRelayCarriesTheCallersToken(t *testing.T) {
	relay, auth := persesUpstream(t)
	app := newTestApp(t, testConfig(t), nil).WithPerses(relay)
	rec := serve(app, asUser(http.MethodGet, "/perses/api/api/v1/dashboards"))
	if rec.Code != http.StatusOK || rec.Body.String() != `[]` {
		t.Fatalf("got %d %q, want Perses's answer", rec.Code, rec.Body)
	}
	if len(*auth) != 1 || (*auth)[0] != "Bearer sha256~token" {
		t.Fatalf("Perses got Authorization %q, want the caller's token from x-forwarded-access-token", *auth)
	}
}

// The relay sits behind the same checks as /api/v1: a caller without a token, and one the hub
// doesn't call a provider admin, never reach Perses.
func TestPersesRelayIsForProviderAdminsOnly(t *testing.T) {
	relay, auth := persesUpstream(t)

	app := newTestApp(t, testConfig(t), nil).WithPerses(relay)
	if rec := serve(app, httptest.NewRequest(http.MethodGet, "/perses/api/api/v1/dashboards", nil)); rec.Code != http.StatusUnauthorized {
		t.Errorf("no token: got %d, want 401", rec.Code)
	}

	viewer := newTestAppWithHub(t, testConfig(t), nil, &fakeHub{allowed: false}).WithPerses(relay)
	rec := serve(viewer, asUser(http.MethodGet, "/perses/api/api/v1/dashboards"))
	if rec.Code != http.StatusForbidden {
		t.Errorf("not a provider admin: got %d, want 403", rec.Code)
	}

	expired := newTestAppWithHub(t, testConfig(t), nil, &fakeHub{status: http.StatusUnauthorized}).WithPerses(relay)
	if rec := serve(expired, asUser(http.MethodGet, "/perses/api/api/v1/dashboards")); rec.Code != http.StatusUnauthorized {
		t.Errorf("token the hub rejects: got %d, want 401", rec.Code)
	}

	if len(*auth) != 0 {
		t.Fatalf("a refused caller reached Perses %d time(s)", len(*auth))
	}
}

func TestPersesRelayRefusesWrites(t *testing.T) {
	relay, auth := persesUpstream(t)
	app := newTestApp(t, testConfig(t), nil).WithPerses(relay)
	rec := serve(app, asUser(http.MethodDelete, "/perses/api/api/v1/projects/p/dashboards/d"))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("got %d, want 405", rec.Code)
	}
	if len(*auth) != 0 {
		t.Fatalf("a write reached Perses")
	}
}

func TestMonitoringOffWithoutPerses(t *testing.T) {
	app := newTestApp(t, testConfig(t), nil)
	rec := serve(app, asUser(http.MethodGet, "/perses/api/api/v1/dashboards"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", rec.Code)
	}
	if msg := decodeError(t, rec).Error.Message; msg != "monitoring is not configured on this console" {
		t.Errorf("message %q", msg)
	}
	var cfg ConsoleConfig
	decodeData(t, serve(app, asUser(http.MethodGet, "/api/v1/config")), &cfg)
	if cfg.Monitoring.Enabled {
		t.Errorf("config says monitoring is on without a Perses server")
	}
}

func TestConfigReportsMonitoring(t *testing.T) {
	relay, _ := persesUpstream(t)
	cfg := testConfig(t)
	cfg.PersesProject = "ai-grid-monitoring"
	app := newTestApp(t, cfg, nil).WithPerses(relay)
	var got ConsoleConfig
	decodeData(t, serve(app, asUser(http.MethodGet, "/api/v1/config")), &got)
	if !got.Monitoring.Enabled || got.Monitoring.PersesProject != "ai-grid-monitoring" {
		t.Errorf("monitoring = %+v, want enabled with project ai-grid-monitoring", got.Monitoring)
	}
}
