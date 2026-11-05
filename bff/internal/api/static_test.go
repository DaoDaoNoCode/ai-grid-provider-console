package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// spaDir is a built frontend of one page and one asset.
func spaDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>index</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "index-yimuxjpv.js"), []byte("asset"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// The map's tile server is the one image source the pages allow besides their own origin; the
// rest of the policy stays as it is.
func TestPagePolicyAllowsTheMapTileServer(t *testing.T) {
	t.Parallel()
	cfg := testConfig(t)
	cfg.StaticAssetsDir = spaDir(t)
	cfg.MapTileURL = "https://{s}.tile.example.com/{z}/{x}/{y}.png"
	h := newTestApp(t, cfg, nil).Handler()
	want := strings.Replace(defaultPagePolicy, "img-src 'self' data:;", "img-src 'self' data: https://*.tile.example.com;", 1)
	for _, p := range []string{"/", "/ai-grid", "/assets/index-yimuxjpv.js"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Content-Security-Policy"); rec.Code != http.StatusOK || got != want {
			t.Errorf("%s -> %d, Content-Security-Policy %q, want %q", p, rec.Code, got, want)
		}
	}

	// A tile server on the console's own origin needs nothing more than 'self'.
	cfg.MapTileURL = "/tiles/{z}/{x}/{y}.png"
	rec := httptest.NewRecorder()
	newTestApp(t, cfg, nil).Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Content-Security-Policy"); got != defaultPagePolicy {
		t.Errorf("a tile path on the console: Content-Security-Policy %q, want %q", got, defaultPagePolicy)
	}
}

// The page policy is for the SPA's files only: the API, the Perses relay and the Connect relay
// keep their own headers, with the SPA served beside them.
func TestRelaysKeepTheirOwnHeadersBesideThePages(t *testing.T) {
	t.Parallel()
	cfg := testConfig(t)
	cfg.StaticAssetsDir = spaDir(t)
	persesRelay, _ := persesUpstream(t)
	connectRelay, _ := connectUpstream(t)
	app := newTestApp(t, cfg, nil).WithPerses(persesRelay).WithRelay(connectRelay)

	if rec := serve(app, asUser(http.MethodGet, "/clusters")); rec.Header().Get("Content-Security-Policy") != defaultPagePolicy {
		t.Fatalf("the page: %v", rec.Header())
	}
	for what, rec := range map[string]*httptest.ResponseRecorder{
		"the API":                serve(app, asUser(http.MethodGet, "/api/v1/config")),
		"an unknown API path":    serve(app, asUser(http.MethodGet, "/api/v1/nothing")),
		"the Connect relay":      serve(app, connectCall(asUser(http.MethodPost, connectList))),
		"an unknown Connect RPC": serve(app, connectCall(asUser(http.MethodPost, "/ai_grid.v1.Clusters/Create"))),
	} {
		if got := rec.Header().Values("Content-Security-Policy"); len(got) != 0 || rec.Header().Get("X-Frame-Options") != "" {
			t.Errorf("%s (%d): Content-Security-Policy %q, X-Frame-Options %q, want neither: it is not a page", what, rec.Code, got, rec.Header().Get("X-Frame-Options"))
		}
		if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q, want nosniff", what, rec.Header().Get("X-Content-Type-Options"))
		}
	}
	rec := serve(app, asUser(http.MethodGet, persesDashboards))
	if got := rec.Header().Values("Content-Security-Policy"); rec.Code != http.StatusOK || len(got) != 1 || got[0] != "sandbox; default-src 'none'" {
		t.Errorf("the Perses relay -> %d, Content-Security-Policy %q, want only the relay's sandbox", rec.Code, got)
	}
}
