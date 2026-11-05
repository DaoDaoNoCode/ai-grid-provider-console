package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
)

// wantStatus fails the test unless rec answered want.
func wantStatus(t *testing.T, what string, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s: status %d (%s), want %d", what, rec.Code, strings.TrimSpace(rec.Body.String()), want)
	}
}

// The readiness probe asks the backend's gRPC health service for the whole server (no service
// name), and a backend that answers but is not serving is not ready.
func TestReadyzAsksTheHealthService(t *testing.T) {
	t.Parallel()
	fake := &backendtest.Fake{}
	app := NewApp(testConfig(t), slog.New(slog.DiscardHandler), backendtest.Start(t, fake), startHub(t, &fakeHub{allowed: true}))
	wantStatus(t, "serving", serve(app, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusOK)
	if calls := fake.Calls(); !slices.Equal(calls, []string{"/grpc.health.v1.Health/Check"}) {
		t.Errorf("calls = %v, want one health check", calls)
	}

	notServing := &backendtest.Fake{NotServing: true}
	app = NewApp(testConfig(t), slog.New(slog.DiscardHandler), backendtest.Start(t, notServing), startHub(t, &fakeHub{allowed: true}))
	wantStatus(t, "not serving", serve(app, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusServiceUnavailable)
}
