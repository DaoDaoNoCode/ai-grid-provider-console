package perses

import (
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAllowed(t *testing.T) {
	for _, tc := range []struct {
		method, path, raw string
		want              int
	}{
		// What the dashboard components read.
		{"GET", "/api/v1/dashboards", "", 0},
		{"GET", "/api/v1/projects/ai-grid-monitoring/dashboards", "", 0},
		{"GET", "/api/v1/projects/ai-grid-monitoring/dashboards/dashboard-0-fleet", "", 0},
		{"GET", "/api/v1/projects/ai-grid-monitoring/datasources", "", 0},
		{"GET", "/api/v1/projects/p/datasources/thanos", "", 0},
		{"GET", "/api/v1/globaldatasources", "", 0},
		{"GET", "/api/v1/globaldatasources/thanos", "", 0},
		// Queries through a datasource's proxy, GET or the Prometheus plugin's POST form.
		{"GET", "/proxy/projects/p/datasources/thanos/api/v1/query", "", 0},
		{"POST", "/proxy/projects/p/datasources/thanos/api/v1/query_range", "", 0},
		{"POST", "/proxy/projects/p/dashboards/d/datasources/thanos/api/v1/series", "", 0},
		{"GET", "/proxy/globaldatasources/thanos/api/v1/label/namespace/values", "", 0},
		{"GET", "/proxy/projects/p/datasources/loki/loki/api/v1/query_range", "", 0},
		// Writes and anything else Perses serves are refused.
		{"POST", "/api/v1/projects/p/dashboards", "", http.StatusMethodNotAllowed},
		{"PUT", "/api/v1/projects/p/dashboards/d", "", http.StatusMethodNotAllowed},
		{"DELETE", "/api/v1/globaldatasources/thanos", "", http.StatusMethodNotAllowed},
		{"POST", "/api/v1/dashboards", "", http.StatusMethodNotAllowed},
		{"GET", "/api/v1/users", "", http.StatusNotFound},
		{"GET", "/api/v1/projects", "", http.StatusNotFound},
		{"GET", "/api/v1/projects/p/secrets", "", http.StatusNotFound},
		{"GET", "/api/auth/providers", "", http.StatusNotFound},
		{"GET", "/proxy/projects/p/datasources/thanos/api/v1/admin/tsdb/delete_series", "", http.StatusNotFound},
		{"GET", "/proxy/projects/p/datasources/thanos/federate", "", http.StatusNotFound},
		{"GET", "/plugins/Prometheus/mf-manifest.json", "", http.StatusNotFound},
		// Paths that could resolve to something else upstream.
		{"GET", "/api/v1/projects/p/dashboards/../../users", "", http.StatusNotFound},
		{"GET", "/api/v1//dashboards", "", http.StatusNotFound},
		{"GET", "/api/v1/dashboards/", "", http.StatusNotFound},
		{"GET", "/api/v1/projects/p/dashboards/a/b", "/api/v1/projects/p/dashboards/a%2Fb", http.StatusNotFound},
		{"GET", "", "", http.StatusNotFound},
	} {
		got, _ := Allowed(tc.method, tc.path, tc.raw)
		if got != tc.want {
			t.Errorf("Allowed(%s %q) = %d, want %d", tc.method, tc.path, got, tc.want)
		}
	}
}

func TestNewValidates(t *testing.T) {
	dir := t.TempDir()
	notPEM := filepath.Join(dir, "ca.txt")
	if err := os.WriteFile(notPEM, []byte("not a certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		cfg  Config
		ok   bool
	}{
		{"https", Config{URL: "https://perses.example.svc:8080"}, true},
		{"loopback plaintext", Config{URL: "http://127.0.0.1:9005"}, true},
		{"localhost plaintext", Config{URL: "http://localhost:9005"}, true},
		{"remote plaintext", Config{URL: "http://perses.example.svc:8080"}, false},
		{"remote plaintext, insecure allowed", Config{URL: "http://perses.example.svc:8080", Insecure: true}, true},
		{"no scheme", Config{URL: "perses.example.svc:8080"}, false},
		{"other scheme", Config{URL: "ftp://perses.example.svc"}, false},
		{"missing CA file", Config{URL: "https://perses.example.svc", CAFile: filepath.Join(dir, "missing.crt")}, false},
		{"CA file without a certificate", Config{URL: "https://perses.example.svc", CAFile: notPEM}, false},
	} {
		_, err := New(tc.cfg)
		if (err == nil) != tc.ok {
			t.Errorf("%s: New() error = %v, want ok=%v", tc.name, err, tc.ok)
		}
	}
}

type upstreamCall struct {
	method, path, query, body string
	header                    http.Header
}

// tlsUpstream starts a TLS server standing in for Perses and returns a relay that trusts it.
func tlsUpstream(t *testing.T, handler func(http.ResponseWriter, *http.Request), calls chan<- upstreamCall, timeout time.Duration) *Relay {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if calls != nil {
			calls <- upstreamCall{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, body: string(body), header: r.Header.Clone()}
		}
		handler(w, r)
	}))
	t.Cleanup(srv.Close)
	ca := filepath.Join(t.TempDir(), "ca.crt")
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	if err := os.WriteFile(ca, pemBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	relay, err := New(Config{URL: srv.URL, CAFile: ca, Timeout: timeout})
	if err != nil {
		t.Fatal(err)
	}
	return relay
}

func serve(relay *Relay, req *http.Request, token string) *httptest.ResponseRecorder {
	if token != "" {
		req = req.WithContext(WithToken(req.Context(), token))
	}
	rec := httptest.NewRecorder()
	relay.ServeHTTP(rec, req)
	return rec
}

func errorMessage(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("error body %q is not the console's envelope: %v", rec.Body, err)
	}
	return body.Error.Code + " " + body.Error.Message
}

func TestRelayForwardsTheCallersTokenAndNothingElseOfTheirs(t *testing.T) {
	calls := make(chan upstreamCall, 1)
	relay := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "perses=session; Path=/")
		_, _ = w.Write([]byte(`[{"kind":"Dashboard"}]`))
	}, calls, 0)

	req := httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/projects/ai-grid-monitoring/dashboards?metadata_only=true", nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer client-sent")
	req.Header.Set("Cookie", "_oauth_proxy=console-session")
	req.Header.Set("X-Forwarded-Access-Token", "proxy-token")
	req.Header.Set("X-Forwarded-User", "alice")
	rec := serve(relay, req, "caller-token")

	if rec.Code != http.StatusOK || rec.Body.String() != `[{"kind":"Dashboard"}]` {
		t.Fatalf("got %d %q, want Perses's answer", rec.Code, rec.Body)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Errorf("Perses's Set-Cookie reached the browser: %q", rec.Header().Get("Set-Cookie"))
	}
	got := <-calls
	if got.path != "/api/v1/projects/ai-grid-monitoring/dashboards" || got.query != "metadata_only=true" {
		t.Errorf("upstream got %s?%s, want the Perses path without the prefix and the same query", got.path, got.query)
	}
	if a := got.header.Get("Authorization"); a != "Bearer caller-token" {
		t.Errorf("Authorization = %q, want the caller's token", a)
	}
	for _, h := range []string{"Cookie", "X-Forwarded-Access-Token", "X-Forwarded-User"} {
		if v := got.header.Get(h); v != "" {
			t.Errorf("%s reached Perses: %q", h, v)
		}
	}
	if got.header.Get("Accept") != "application/json" {
		t.Errorf("Accept was dropped")
	}
}

func TestRelayPassesPersesErrorsThrough(t *testing.T) {
	relay := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"forbidden"}`))
	}, nil, 0)
	rec := serve(relay, httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/projects/other/dashboards", nil), "t")
	if rec.Code != http.StatusForbidden || rec.Body.String() != `{"message":"forbidden"}` {
		t.Fatalf("got %d %q, want Perses's 403 as it sent it", rec.Code, rec.Body)
	}
}

func TestRelayQueriesWithTheFormThePrometheusPluginSends(t *testing.T) {
	calls := make(chan upstreamCall, 1)
	relay := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}, calls, 0)
	path := Prefix + "/proxy/projects/p/datasources/thanos/api/v1/query_range"
	form := "query=up&start=1&end=2&step=15"

	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if rec := serve(relay, req, "t"); rec.Code != http.StatusOK {
		t.Fatalf("query: got %d %q", rec.Code, rec.Body)
	}
	got := <-calls
	if got.method != http.MethodPost || got.body != form || got.header.Get("Content-Type") != "application/x-www-form-urlencoded" {
		t.Errorf("upstream got %s %q (%s), want the form unchanged", got.method, got.body, got.header.Get("Content-Type"))
	}

	req = httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"query":"up"}`))
	req.Header.Set("Content-Type", "application/json")
	if rec := serve(relay, req, "t"); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("JSON query: got %d, want 415", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, path, strings.NewReader("query="+strings.Repeat("a", MaxBodyBytes)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if rec := serve(relay, req, "t"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized query: got %d %q, want 413", rec.Code, rec.Body)
	}
}

func TestRelayRefuses(t *testing.T) {
	calls := make(chan upstreamCall, 1)
	relay := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) {}, calls, 0)
	for _, tc := range []struct {
		name  string
		req   *http.Request
		token string
		want  int
	}{
		{"no token", httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/dashboards", nil), "", http.StatusUnauthorized},
		{"a write", httptest.NewRequest(http.MethodDelete, Prefix+"/api/v1/projects/p/dashboards/d", nil), "t", http.StatusMethodNotAllowed},
		{"a path outside the allowlist", httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/users", nil), "t", http.StatusNotFound},
		{"outside the prefix", httptest.NewRequest(http.MethodGet, "/other/api/v1/dashboards", nil), "t", http.StatusNotFound},
	} {
		rec := serve(relay, tc.req, tc.token)
		if rec.Code != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, rec.Code, tc.want)
		}
		_ = errorMessage(t, rec)
	}
	select {
	case c := <-calls:
		t.Errorf("a refused request reached Perses: %s %s", c.method, c.path)
	default:
	}
}

func TestRelayWhenPersesFails(t *testing.T) {
	// Down: nothing listens at the address.
	relay, err := New(Config{URL: "http://127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	rec := serve(relay, httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/dashboards", nil), "t")
	if rec.Code != http.StatusBadGateway {
		t.Errorf("down: got %d, want 502", rec.Code)
	}
	if msg := errorMessage(t, rec); !strings.Contains(msg, "could not be reached") {
		t.Errorf("down: message %q", msg)
	}

	// Slow: the response headers don't arrive within the timeout.
	release := make(chan struct{})
	slow := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) { <-release }, nil, 50*time.Millisecond)
	defer close(release)
	rec = serve(slow, httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/dashboards", nil), "t")
	if rec.Code != http.StatusGatewayTimeout {
		t.Errorf("slow: got %d %q, want 504", rec.Code, rec.Body)
	}

	// Slow answer: the headers arrive, the body stalls; the timeout cuts it too.
	stall := make(chan struct{})
	defer close(stall)
	stalls := tlsUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"partial":`))
		w.(http.Flusher).Flush()
		<-stall
	}, nil, 50*time.Millisecond)
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		done <- serve(stalls, httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/dashboards", nil), "t")
	}()
	select {
	case rec = <-done:
		if rec.Body.String() != `{"partial":` {
			t.Errorf("slow answer: body %q", rec.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("slow answer: the relay did not cut a stalled body at its timeout")
	}

	// Untrusted: the certificate isn't signed by the configured CA.
	other := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer other.Close()
	untrusted, err := New(Config{URL: other.URL})
	if err != nil {
		t.Fatal(err)
	}
	rec = serve(untrusted, httptest.NewRequest(http.MethodGet, Prefix+"/api/v1/dashboards", nil), "t")
	if rec.Code != http.StatusBadGateway {
		t.Errorf("untrusted certificate: got %d, want 502", rec.Code)
	}
}
