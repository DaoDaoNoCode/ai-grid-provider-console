package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
)

// The BFF reaches two kinds of backend over gRPC. The console's fake serves the draft API
// (`make run-fake`); ai-grid-provider-backend serves its own ai_grid.v1, of which the BFF calls
// only AiGrid/Ping (the pages call the rest over Connect, through the relay). The tests in this
// file run what both share against both, so a change that works on the fake and breaks the
// production path fails.

// backendShape is one backend the BFF can be dialed to. start fails every call with err when
// it is set.
type backendShape struct {
	name  string
	start func(t *testing.T, err error) *backend.Client
}

var backendShapes = []backendShape{
	{"draft", func(t *testing.T, err error) *backend.Client {
		return backendtest.Start(t, &backendtest.Fake{Err: err})
	}},
	{"v1", func(t *testing.T, err error) *backend.Client {
		return backendtest.StartV1(t, &backendtest.V1{Err: err})
	}},
}

// wantStatus fails the test unless rec answered want.
func wantStatus(t *testing.T, what string, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s: status %d (%s), want %d", what, rec.Code, strings.TrimSpace(rec.Body.String()), want)
	}
}

// The readiness probe pings either backend, and says when it can't.
func TestReadyzOnEveryBackend(t *testing.T) {
	t.Parallel()
	for _, shape := range backendShapes {
		t.Run(shape.name, func(t *testing.T) {
			t.Parallel()
			ready := NewApp(testConfig(t), slog.New(slog.DiscardHandler), shape.start(t, nil), startHub(t, &fakeHub{allowed: true}))
			wantStatus(t, "ready", serve(ready, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusOK)
			down := NewApp(testConfig(t), slog.New(slog.DiscardHandler), shape.start(t, backendtest.Status(codes.Unavailable, "down")), startHub(t, &fakeHub{allowed: true}))
			wantStatus(t, "down", serve(down, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusServiceUnavailable)
		})
	}
}

// The caller's identity reaches the backend, and the backend's codes map to HTTP statuses,
// keeping the backend's message only for a client-caused failure.
func TestIdentityAndErrorsReachTheBackend(t *testing.T) {
	t.Parallel()
	fake := &backendtest.Fake{}
	app := newTestApp(t, testConfig(t), fake)
	wantStatus(t, "overview", serve(app, asUser(http.MethodGet, "/api/v1/grid/overview?range=1h")), http.StatusOK)
	for key, want := range map[string]string{
		backend.MetaAuthorization: "Bearer sha256~token",
		backend.MetaUser:          "alice",
		backend.MetaEmail:         "alice@example.com",
		backend.MetaGroups:        "system:authenticated,cluster-admins",
	} {
		if v := strings.Join(fake.Metadata.Get(key), "|"); v != want {
			t.Errorf("metadata %s = %q, want %q", key, v, want)
		}
	}

	// keep: the answer carries the backend's message (a client-caused failure).
	for _, tc := range []struct {
		code codes.Code
		want int
		keep bool
	}{
		{codes.PermissionDenied, http.StatusForbidden, true},
		{codes.Unauthenticated, http.StatusUnauthorized, false},
		{codes.NotFound, http.StatusNotFound, true},
		{codes.Aborted, http.StatusConflict, true},
		{codes.FailedPrecondition, http.StatusPreconditionFailed, true},
		{codes.InvalidArgument, http.StatusUnprocessableEntity, true},
		{codes.Unimplemented, http.StatusNotImplemented, false},
		{codes.Unavailable, http.StatusServiceUnavailable, false},
		{codes.Internal, http.StatusBadGateway, false},
	} {
		t.Run(tc.code.String(), func(t *testing.T) {
			t.Parallel()
			app := newTestApp(t, testConfig(t), &backendtest.Fake{Err: backendtest.Status(tc.code, "backend said no")})
			rec := serve(app, asUser(http.MethodGet, "/api/v1/grid/overview?range=1h"))
			if msg := decodeError(t, rec).Error.Message; rec.Code != tc.want || (msg == "backend said no") != tc.keep {
				t.Errorf("%d %q, want %d (backend's message kept: %v)", rec.Code, msg, tc.want, tc.keep)
			}
		})
	}
}

// The backend has no Grid service: a method it doesn't serve answers Unimplemented without
// reaching a handler, which the BFF answers 501.
func TestV1BackendAnswers501ForWhatItLacks(t *testing.T) {
	t.Parallel()
	for _, path := range []string{
		"/api/v1/grid/overview?range=1h",
		"/api/v1/grid/overview?range=24h&site=brussels&metrics=false",
	} {
		t.Run(path, func(t *testing.T) {
			t.Parallel()
			v1 := &backendtest.V1{}
			app := NewApp(testConfig(t), slog.New(slog.DiscardHandler), backendtest.StartV1(t, v1), startHub(t, &fakeHub{allowed: true}))
			wantStatus(t, path, serve(app, asUser(http.MethodGet, path)), http.StatusNotImplemented)
			if calls := v1.Calls(); len(calls) != 0 {
				t.Errorf("reached the backend's %v", calls)
			}
		})
	}
}
