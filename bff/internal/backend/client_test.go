package backend_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
)

func TestDialValidation(t *testing.T) {
	t.Parallel()
	if _, err := backend.Dial(backend.Config{}); err == nil {
		t.Fatal("empty address accepted")
	}
	if _, err := backend.Dial(backend.Config{Address: "127.0.0.1:9090", CAFile: "/nonexistent/ca.crt"}); err == nil || !strings.Contains(err.Error(), "backend CA") {
		t.Fatalf("missing CA file not reported: %v", err)
	}
	if _, err := backend.Dial(backend.Config{Address: "ai-grid-backend.ai-grid.svc:8080"}); err == nil || !strings.Contains(err.Error(), "not loopback") {
		t.Fatalf("plaintext to a remote host accepted: %v", err)
	}
	for _, addr := range []string{"127.0.0.1:9090", "localhost:9090", "[::1]:9090"} {
		c, err := backend.Dial(backend.Config{Address: addr})
		if err != nil {
			t.Fatalf("loopback %s rejected: %v", addr, err)
		}
		_ = c.Close()
	}
	c, err := backend.Dial(backend.Config{Address: "ai-grid-backend.ai-grid.svc:8080", Insecure: true})
	if err != nil {
		t.Fatalf("explicit insecure rejected: %v", err)
	}
	_ = c.Close()
}

func TestEncodeMetadataValue(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"":                       "",
		"alice":                  "alice",
		"system:authenticated":   "system:authenticated",
		"a b~!*'()+=&?/":         "a b~!*'()+=&?/",
		"rené":                   "ren%C3%A9",
		"100%":                   "100%25",
		"tab\there":              "tab%09here",
		"del\x7f":                "del%7F",
		"\xff":                   "%FF",
		"日本":                     "%E6%97%A5%E6%9C%AC",
		"already%C3%A9-escaped?": "already%25C3%25A9-escaped?",
	}
	for in, want := range cases {
		got := backend.EncodeMetadataValue(in)
		if got != want {
			t.Errorf("EncodeMetadataValue(%q) = %q, want %q", in, got, want)
		}
		if back, err := url.PathUnescape(got); err != nil || back != in {
			t.Errorf("PathUnescape(%q) = %q, %v; want %q", got, back, err, in)
		}
	}
}

// Unset timeouts take the relay's defaults: 10 seconds to read, 30 to write.
func TestTimeoutDefaults(t *testing.T) {
	t.Parallel()
	read, write := backend.Config{}.Timeouts()
	if read != 10*time.Second || write != 30*time.Second {
		t.Fatalf("Timeouts() = %s, %s; want 10s, 30s", read, write)
	}
}
