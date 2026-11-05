package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
)

// The readiness probe asks the backend's gRPC health service for the whole server (no service
// name), and a backend that answers but is not serving is not ready.
func TestReadyzAsksTheHealthService(t *testing.T) {
	t.Parallel()
	v1 := &backendtest.V1{}
	app := NewApp(testConfig(t), slog.New(slog.DiscardHandler), backendtest.StartV1(t, v1), startHub(t, &fakeHub{allowed: true}))
	wantStatus(t, "serving", serve(app, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusOK)
	if calls := v1.Calls(); !slices.Equal(calls, []string{"/grpc.health.v1.Health/Check"}) {
		t.Errorf("calls = %v, want one health check", calls)
	}

	notServing := &backendtest.V1{NotServing: true}
	app = NewApp(testConfig(t), slog.New(slog.DiscardHandler), backendtest.StartV1(t, notServing), startHub(t, &fakeHub{allowed: true}))
	wantStatus(t, "not serving", serve(app, httptest.NewRequest(http.MethodGet, "/readyz", nil)), http.StatusServiceUnavailable)
}
