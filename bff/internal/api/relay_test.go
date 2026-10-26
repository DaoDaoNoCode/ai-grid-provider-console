package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/config"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/relay"
)

const connectList = "/ai_grid.v1.Clusters/List"

// connectUpstream stands in for the backend's Connect port and records the Authorization it got.
func connectUpstream(t *testing.T) (*relay.Relay, *[]string) {
	t.Helper()
	var auth []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = append(auth, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"size":0,"total":0}`))
	}))
	t.Cleanup(srv.Close)
	r, err := relay.New(relay.Config{
		Backend:         backend.Config{Address: strings.TrimPrefix(srv.URL, "http://")},
		IdentityHeaders: []string{config.DefaultAuthTokenHeader, config.DefaultAuthUserHeader, config.DefaultAuthEmailHeader, config.DefaultAuthGroupsHeader},
		Logger:          slog.New(slog.DiscardHandler),
	})
	if err != nil {
		t.Fatal(err)
	}
	return r, &auth
}

func connectCall(req *http.Request) *http.Request {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	return req
}

func decodeConnectError(t *testing.T, rec *httptest.ResponseRecorder) (code, message string) {
	t.Helper()
	var body struct{ Code, Message string }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode Connect error %q: %v", rec.Body, err)
	}
	return body.Code, body.Message
}

func TestConnectRelayCarriesTheCallersToken(t *testing.T) {
	r, auth := connectUpstream(t)
	hub := &fakeHub{allowed: true}
	app := newTestAppWithHub(t, testConfig(t), nil, hub).WithRelay(r)
	rec := serve(app, connectCall(asUser(http.MethodPost, connectList)))
	if rec.Code != http.StatusOK || rec.Body.String() != `{"size":0,"total":0}` {
		t.Fatalf("got %d %q, want the backend's answer", rec.Code, rec.Body)
	}
	if len(*auth) != 1 || (*auth)[0] != "Bearer sha256~token" {
		t.Fatalf("backend got Authorization %q, want the caller's token from x-forwarded-access-token", *auth)
	}
	if hub.auth != "Bearer sha256~token" {
		t.Fatalf("the provider-admin check was asked with %q", hub.auth)
	}
}

// The relay sits behind the same checks as /api/v1, and answers them as Connect errors: a caller
// without a token, one the hub rejects, and one it doesn't call a provider admin never reach the
// backend.
func TestConnectRelayIsForProviderAdminsOnly(t *testing.T) {
	r, auth := connectUpstream(t)
	for _, tc := range []struct {
		name     string
		hub      *fakeHub
		req      *http.Request
		status   int
		code     string
		message  string
		contains bool
	}{
		{"no token", &fakeHub{allowed: true}, connectCall(httptest.NewRequest(http.MethodPost, connectList, nil)), http.StatusUnauthorized, "unauthenticated", "missing x-forwarded-access-token header", false},
		{"forged Authorization only", &fakeHub{allowed: true}, func() *http.Request {
			req := connectCall(httptest.NewRequest(http.MethodPost, connectList, nil))
			req.Header.Set("Authorization", "Bearer sha256~forged")
			return req
		}(), http.StatusUnauthorized, "unauthenticated", "missing x-forwarded-access-token header", false},
		{"token the hub rejects", &fakeHub{status: http.StatusUnauthorized}, connectCall(asUser(http.MethodPost, connectList)), http.StatusUnauthorized, "unauthenticated", "the hub rejected the credentials; log in again", false},
		{"not a provider admin", &fakeHub{allowed: false}, connectCall(asUser(http.MethodPost, connectList)), http.StatusForbidden, "permission_denied", "this console is only for provider admins", true},
		{"not a provider admin, GET", &fakeHub{allowed: false}, asUser(http.MethodGet, "/ai_grid.v1.Clusters/Get?message=%7B%7D&encoding=json"), http.StatusForbidden, "permission_denied", "this console is only for provider admins", true},
		{"hub failing", &fakeHub{status: http.StatusInternalServerError}, connectCall(asUser(http.MethodPost, connectList)), http.StatusBadGateway, "unavailable", "the hub could not confirm the caller's permissions; try again", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := newTestAppWithHub(t, testConfig(t), nil, tc.hub).WithRelay(r)
			rec := serve(app, tc.req)
			code, msg := decodeConnectError(t, rec)
			if rec.Code != tc.status || code != tc.code || (tc.contains && !strings.Contains(msg, tc.message)) || (!tc.contains && msg != tc.message) {
				t.Fatalf("got %d %s %q, want %d %s %q", rec.Code, code, msg, tc.status, tc.code, tc.message)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type %q", ct)
			}
		})
	}
	if len(*auth) != 0 {
		t.Fatalf("a refused caller reached the backend %d time(s)", len(*auth))
	}
}

// The relay's own refusals come after the caller checks, as a 405 on /api/v1 does.
func TestConnectRelayRefusalsAfterTheCallerChecks(t *testing.T) {
	r, auth := connectUpstream(t)
	viewer := newTestAppWithHub(t, testConfig(t), nil, &fakeHub{allowed: false}).WithRelay(r)
	if rec := serve(viewer, asUser(http.MethodDelete, connectList)); rec.Code != http.StatusForbidden {
		t.Errorf("a viewer's DELETE: got %d, want 403", rec.Code)
	}
	admin := newTestApp(t, testConfig(t), nil).WithRelay(r)
	if rec := serve(admin, asUser(http.MethodDelete, connectList)); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("an admin's DELETE: got %d, want 405", rec.Code)
	}
	// Not cleaned or redirected by the mux into another route: refused as no procedure.
	rec := serve(admin, connectCall(asUser(http.MethodPost, "/ai_grid.v1.Clusters/../../api/v1/user")))
	if code, _ := decodeConnectError(t, rec); rec.Code != http.StatusNotFound || code != "unimplemented" {
		t.Errorf("unclean path: got %d %s", rec.Code, code)
	}
	if len(*auth) != 0 {
		t.Fatalf("a refused call reached the backend %d time(s)", len(*auth))
	}
}

func TestConnectRelayOffWithoutOne(t *testing.T) {
	app := newTestApp(t, testConfig(t), nil)
	rec := serve(app, connectCall(asUser(http.MethodPost, connectList)))
	if code, _ := decodeConnectError(t, rec); rec.Code != http.StatusNotFound || code != "unimplemented" {
		t.Fatalf("got %d %s", rec.Code, code)
	}
}

// The JSON API keeps its own envelope next to the relay.
func TestAPIErrorsKeepTheirEnvelopeWithTheRelay(t *testing.T) {
	r, _ := connectUpstream(t)
	app := newTestAppWithHub(t, testConfig(t), nil, &fakeHub{allowed: false}).WithRelay(r)
	rec := serve(app, asUser(http.MethodGet, "/api/v1/clusters"))
	if rec.Code != http.StatusForbidden || decodeError(t, rec).Error.Code != "403" {
		t.Fatalf("got %d %q", rec.Code, rec.Body)
	}
	rec = serve(app, httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil))
	if rec.Code != http.StatusUnauthorized || decodeError(t, rec).Error.Code != "401" {
		t.Fatalf("got %d %q", rec.Code, rec.Body)
	}
}
