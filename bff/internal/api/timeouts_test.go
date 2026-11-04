package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

// A request that changes data (POST, PATCH, PUT, DELETE) calls the backend under the write
// timeout, any other under the read timeout. The client dials lazily, so nothing is called.
func TestBackendContextPicksTheTimeoutByMethod(t *testing.T) {
	t.Parallel()
	const read, write = time.Minute, time.Hour
	client, err := backend.Dial(backend.Config{Address: "127.0.0.1:1", Timeout: read, WriteTimeout: write})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	app := NewApp(testConfig(t), slog.New(slog.DiscardHandler), client, nil)
	for method, want := range map[string]time.Duration{
		http.MethodGet:    read,
		http.MethodHead:   read,
		http.MethodPost:   write,
		http.MethodPatch:  write,
		http.MethodPut:    write,
		http.MethodDelete: write,
	} {
		start := time.Now()
		ctx, cancel := app.backendContext(httptest.NewRequest(method, "/api/v1/tenants", nil))
		deadline, ok := ctx.Deadline()
		cancel()
		// The deadline is set after start, at most the bound after it; the two bounds are far apart.
		if got := deadline.Sub(start); !ok || got < want || got > want+time.Minute {
			t.Errorf("%s: deadline %s after the request, want %s", method, got, want)
		}
	}
}

// Unset timeouts take the gRPC client's defaults: 10 seconds to read, 30 to write.
func TestTimeoutDefaults(t *testing.T) {
	t.Parallel()
	read, write := backend.Config{}.Timeouts()
	if read != 10*time.Second || write != 30*time.Second {
		t.Fatalf("Timeouts() = %s, %s; want 10s, 30s", read, write)
	}
}
