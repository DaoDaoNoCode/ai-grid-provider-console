package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/perses"
)

// persesProject is the Perses project the test relays read, and persesDashboards its list.
const (
	persesProject    = "ai-grid-monitoring"
	persesDashboards = "/perses/api/api/v1/projects/" + persesProject + "/dashboards"
)

// persesUpstream stands in for the hub's Perses and records the Authorization it got.
func persesUpstream(t *testing.T) (*perses.Relay, *recorder) {
	t.Helper()
	auth := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.add(r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(srv.Close)
	// A loopback http:// target, as for a port-forward in development.
	relay, err := perses.New(perses.Config{URL: srv.URL, Project: persesProject})
	if err != nil {
		t.Fatal(err)
	}
	return relay, auth
}

func TestPersesRelayCarriesTheCallersToken(t *testing.T) {
	t.Parallel()
	relay, auth := persesUpstream(t)
	app := newTestApp(t, testConfig(t), nil).WithPerses(relay)
	rec := serve(app, asUser(http.MethodGet, persesDashboards))
	if rec.Code != http.StatusOK || rec.Body.String() != `[]` {
		t.Fatalf("got %d %q, want Perses's answer", rec.Code, rec.Body)
	}
	if len(auth.values()) != 1 || auth.values()[0] != "Bearer sha256~token" {
		t.Fatalf("Perses got Authorization %q, want the caller's token from x-forwarded-access-token", auth.values())
	}
}

// persesError decodes an error answered on a Perses path. The Perses components show a string
// "message" (@perses-dev/client's fetch), so it must be exactly {"message": "..."}: the console's
// envelope reached a panel as "[object Object]".
func persesError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type %q, want application/json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", rec.Body, err)
	}
	msg, ok := body["message"].(string)
	if len(body) != 1 || !ok || msg == "" {
		t.Fatalf("body %q, want {\"message\": \"...\"}", rec.Body)
	}
	return msg
}

// The relay sits behind the same checks as /api/v1: a caller without a token, and one the hub
// doesn't call a provider admin, never reach Perses. The checks answer in Perses's error shape,
// so a panel shows their message.
func TestPersesRelayIsForProviderAdminsOnly(t *testing.T) {
	t.Parallel()
	relay, auth := persesUpstream(t)
	for _, tc := range []struct {
		name    string
		hub     *fakeHub
		req     *http.Request
		status  int
		message string
	}{
		{"no token", &fakeHub{allowed: true}, httptest.NewRequest(http.MethodGet, persesDashboards, nil), http.StatusUnauthorized, "missing x-forwarded-access-token header"},
		{"token the hub rejects", &fakeHub{status: http.StatusUnauthorized}, asUser(http.MethodGet, persesDashboards), http.StatusUnauthorized, "the hub rejected the credentials; log in again"},
		{"not a provider admin", &fakeHub{allowed: false}, asUser(http.MethodGet, persesDashboards), http.StatusForbidden, "this console is only for provider admins"},
		{"hub failing", &fakeHub{status: http.StatusInternalServerError}, asUser(http.MethodPost, "/perses/api/proxy/projects/"+persesProject+"/datasources/thanos/api/v1/query_range"), http.StatusBadGateway, "the hub could not confirm the caller's permissions; try again"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithHub(t, testConfig(t), nil, tc.hub).WithPerses(relay)
			rec := serve(app, tc.req)
			if rec.Code != tc.status {
				t.Fatalf("got %d %q, want %d", rec.Code, rec.Body, tc.status)
			}
			if msg := persesError(t, rec); !strings.HasPrefix(msg, tc.message) {
				t.Errorf("message %q, want %q", msg, tc.message)
			}
		})
	}
	if len(auth.values()) != 0 {
		t.Fatalf("a refused caller reached Perses %d time(s)", len(auth.values()))
	}
}

func TestPersesRelayRefusesWrites(t *testing.T) {
	t.Parallel()
	relay, auth := persesUpstream(t)
	app := newTestApp(t, testConfig(t), nil).WithPerses(relay)
	rec := serve(app, asUser(http.MethodDelete, persesDashboards+"/d"))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("got %d, want 405", rec.Code)
	}
	if len(auth.values()) != 0 {
		t.Fatalf("a write reached Perses")
	}
}

func TestMonitoringOffWithoutPerses(t *testing.T) {
	t.Parallel()
	app := newTestApp(t, testConfig(t), nil)
	rec := serve(app, asUser(http.MethodGet, persesDashboards))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", rec.Code)
	}
	if msg := persesError(t, rec); msg != "monitoring is not configured on this console" {
		t.Errorf("message %q", msg)
	}
	var cfg ConsoleConfig
	decodeData(t, serve(app, asUser(http.MethodGet, "/api/v1/config")), &cfg)
	if cfg.Monitoring.Enabled {
		t.Errorf("config says monitoring is on without a Perses server")
	}
}

func TestConfigReportsMonitoring(t *testing.T) {
	t.Parallel()
	relay, _ := persesUpstream(t)
	cfg := testConfig(t)
	cfg.PersesProject = persesProject
	app := newTestApp(t, cfg, nil).WithPerses(relay)
	var got ConsoleConfig
	decodeData(t, serve(app, asUser(http.MethodGet, "/api/v1/config")), &got)
	if !got.Monitoring.Enabled || got.Monitoring.PersesProject != persesProject {
		t.Errorf("monitoring = %+v, want enabled with project ai-grid-monitoring", got.Monitoring)
	}
}

// lockedBuffer is a log sink the server's handler goroutines and the test can share.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// Perses stalls after the first bytes of an answer: under a real server the relay cuts the
// connection at its timeout. The browser gets no answer (the bytes were still in the server's
// buffer) or a truncated one, never a 500 written over it, and the request is still logged.
func TestPersesAnswerCutAtTheTimeout(t *testing.T) {
	// Not parallel: the headers must arrive within the 100 ms timeout.
	stall := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"partial":`))
		w.(http.Flusher).Flush()
		<-stall
	}))
	defer upstream.Close()
	defer close(stall)
	relay, err := perses.New(perses.Config{URL: upstream.URL, Project: persesProject, Timeout: 100 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	logs := &lockedBuffer{}
	app := NewApp(testConfig(t), slog.New(slog.NewTextHandler(logs, nil)), backendtest.Start(t, &backendtest.Fake{}), startHub(t, &fakeHub{allowed: true})).WithPerses(relay)
	srv := httptest.NewServer(app.Handler())
	t.Cleanup(srv.Close) // also after a failure; Close is idempotent

	in := asUser(http.MethodGet, persesDashboards)
	// Far past the relay's timeout: if the relay stops cutting the exchange, fail rather than hang.
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+in.URL.Path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header = in.Header.Clone()
	resp, err := srv.Client().Do(req)
	if errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("the relay did not cut a stalled answer at its timeout")
	}
	if err == nil {
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		// At most the bytes Perses sent before it stalled.
		if errors.Is(readErr, context.DeadlineExceeded) {
			t.Fatal("the relay did not cut a stalled answer at its timeout")
		}
		if sent := `{"partial":`; resp.StatusCode != http.StatusOK || len(body) > len(sent) || string(body) != sent[:len(body)] || readErr == nil {
			t.Fatalf("got %d %q (read error %v), want a cut connection", resp.StatusCode, body, readErr)
		}
	}
	srv.Close() // waits for the handler, so its log line is written
	if out := logs.String(); !strings.Contains(out, `msg="request aborted"`) || strings.Contains(out, "panic serving request") {
		t.Fatalf("log should hold the aborted request and no panic:\n%s", out)
	}
}
