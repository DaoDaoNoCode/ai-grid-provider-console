package examples

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/api"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/config"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/hub"
)

var update = flag.Bool("update", false, "rewrite mock/examples from the current BFF")

const examplesDir = "../../../mock/examples"

// caller is who sends a request, as kube-auth-proxy (or the Vite dev proxy
// under make dev-fake) would set the identity headers. The tokens are the
// ones the backend's fake hub knows (its fixtures' access.json), which the
// hub below answers the same way.
type caller struct{ token, user string }

var (
	admin   = caller{"dev-token", "dev-user"}
	viewer  = caller{"viewer-token", "viewer"}
	expired = caller{"expired-token", "expired"}
)

// example is one golden file: a request and the BFF's answer. A body is
// sent as application/json unless header sets another Content-Type.
type example struct {
	file   string
	method string
	path   string
	body   string
	header map[string]string
	as     caller
}

var examples = []example{
	{file: "get-user.json", method: http.MethodGet, path: "/api/v1/user", as: admin},
	{file: "get-config.json", method: http.MethodGet, path: "/api/v1/config", as: admin},
	{file: "error-401-expired-token.json", method: http.MethodGet, path: "/api/v1/user", as: expired},
	// The Monitoring page's list of dashboards: the Perses relay has the API's caller checks.
	{file: "error-403-viewer.json", method: http.MethodGet, path: "/perses/api/api/v1/projects/ai-grid/dashboards", as: viewer},
	// The organizations moved to the backend's Tenants over Connect; the JSON path is gone.
	{file: "error-404-unknown-path.json", method: http.MethodGet, path: "/api/v1/tenants", as: admin},
	{file: "error-405-wrong-method.json", method: http.MethodPost, path: "/api/v1/config", body: `{}`, as: admin},
}

// recordedHeaders are the response headers a golden file keeps.
var recordedHeaders = []string{"Allow"}

// golden is the file format: the request line, its headers beyond the
// identity ones, who sent it, the status code, the Allow response header
// when set, and the response body exactly as the BFF
// encoded it (re-indented).
type golden struct {
	Request         string            `json:"request"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	RequestBody     json.RawMessage   `json:"requestBody,omitempty"`
	Token           string            `json:"token"`
	User            string            `json:"user"`
	Status          int               `json:"status"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	Body            json.RawMessage   `json:"body,omitempty"`
}

// TestGoldenResponses renders every example on a BFF and hub of its own, so
// no example depends on another.
func TestGoldenResponses(t *testing.T) {
	want := map[string]bool{}
	for _, ex := range examples {
		want[ex.file] = true
		t.Run(strings.TrimSuffix(ex.file, ".json"), func(t *testing.T) {
			got := render(t, newApp(t), ex)
			path := filepath.Join(examplesDir, ex.file)
			if *update {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			old, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v; run `make -C bff golden` to create it", err)
			}
			if !bytes.Equal(old, got) {
				t.Errorf("mock/examples/%s is out of date (%s); if the change is intended, run `make -C bff golden` and review the diff.\n%s",
					ex.file, ex.method+" "+ex.path, firstDifference(old, got))
			}
		})
	}
	entries, err := os.ReadDir(examplesDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".json" || want[e.Name()] {
			continue
		}
		if *update {
			if err := os.Remove(filepath.Join(examplesDir, e.Name())); err != nil {
				t.Fatal(err)
			}
			continue
		}
		t.Errorf("mock/examples/%s is not produced by any example; run `make -C bff golden` to remove it", e.Name())
	}
}

// newApp builds the BFF against the hub below over httptest. No example
// reaches the backend: the client points at an address nothing listens on,
// which a call would fail on.
func newApp(t *testing.T) *api.App {
	t.Helper()
	logger := slog.New(slog.DiscardHandler)
	client, err := backend.Dial(backend.Config{Address: "127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	hubSrv := httptest.NewServer(http.HandlerFunc(accessReview))
	t.Cleanup(func() {
		_ = client.Close()
		hubSrv.Close()
	})
	hubClient, err := hub.New(hub.Config{URL: hubSrv.URL})
	if err != nil {
		t.Fatal(err)
	}
	// No environment, so the files do not depend on the shell that ran the
	// test: every setting is its default.
	cfg, err := config.Parse([]string{"--hub-api-url=" + hubSrv.URL}, func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	return api.NewApp(cfg, logger, client, hubClient)
}

// accessReview answers the BFF's provider-admin SelfSubjectAccessReview as a
// hub does for the three callers: the expired token is the API server's 401,
// the viewer is not allowed, and the admin is.
func accessReview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Header.Get("Authorization") {
	case "Bearer " + expired.token:
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"Unauthorized","reason":"Unauthorized","code":401}`))
	case "Bearer " + admin.token:
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"status":{"allowed":true}}`))
	default:
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"status":{"allowed":false}}`))
	}
}

func render(t *testing.T, app *api.App, ex example) []byte {
	t.Helper()
	req := httptest.NewRequest(ex.method, ex.path, strings.NewReader(ex.body))
	if ex.body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range ex.header {
		req.Header.Set(k, v)
	}
	req.Header.Set(config.DefaultAuthTokenHeader, ex.as.token)
	req.Header.Set(config.DefaultAuthUserHeader, ex.as.user)
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)

	g := golden{Request: ex.method + " " + ex.path, RequestHeaders: ex.header, Token: ex.as.token, User: ex.as.user, Status: rec.Code}
	if ex.body != "" {
		g.RequestBody = json.RawMessage(ex.body)
	}
	for _, h := range recordedHeaders {
		if v := rec.Header().Get(h); v != "" {
			if g.ResponseHeaders == nil {
				g.ResponseHeaders = map[string]string{}
			}
			g.ResponseHeaders[h] = v
		}
	}
	if rec.Body.Len() > 0 {
		if !json.Valid(rec.Body.Bytes()) {
			t.Fatalf("%s: response is not JSON: %q", g.Request, rec.Body.String())
		}
		g.Body = json.RawMessage(rec.Body.Bytes())
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(g); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// firstDifference shows the first line where the committed file and the
// current response differ, with a little context, so a failure says what
// changed without a diff tool.
func firstDifference(old, got []byte) string {
	a, b := strings.Split(string(old), "\n"), strings.Split(string(got), "\n")
	for i := 0; i < len(a) || i < len(b); i++ {
		var la, lb string
		if i < len(a) {
			la = a[i]
		}
		if i < len(b) {
			lb = b[i]
		}
		if la == lb {
			continue
		}
		from := max(i-2, 0)
		var s strings.Builder
		fmt.Fprintf(&s, "first difference at line %d:\n", i+1)
		for j := from; j < i; j++ {
			fmt.Fprintf(&s, "    %s\n", a[j])
		}
		fmt.Fprintf(&s, "  - %s\n  + %s", la, lb)
		return s.String()
	}
	return "files differ only in trailing bytes"
}
