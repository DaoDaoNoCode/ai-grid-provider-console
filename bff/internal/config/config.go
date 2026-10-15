// Package config holds the BFF runtime configuration, populated from flags with
// environment-variable fallbacks.
package config

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Header names set by kube-auth-proxy (--pass-access-token, --pass-user-headers).
// The frontend dev proxy sets the same headers from `oc whoami`.
const (
	DefaultAuthTokenHeader  = "x-forwarded-access-token"
	DefaultAuthUserHeader   = "x-forwarded-user"
	DefaultAuthEmailHeader  = "x-forwarded-email"
	DefaultAuthGroupsHeader = "x-forwarded-groups"
	// DefaultBackendAddress is the backend container in the same pod.
	DefaultBackendAddress = "127.0.0.1:9090"
)

// Config is the fully resolved BFF configuration.
type Config struct {
	// BindAddress is the host part of the listen address. Empty binds all interfaces.
	BindAddress string
	Port        int
	// CertFile and KeyFile enable TLS when both are set.
	CertFile string
	KeyFile  string

	// Proxy headers carrying the caller's identity.
	AuthTokenHeader  string
	AuthTokenPrefix  string
	AuthUserHeader   string
	AuthEmailHeader  string
	AuthGroupsHeader string
	// ProviderAdminGroups marks callers in any of these groups as provider
	// admins for the UI. Empty means every signed-in user. The backend
	// enforces authorization regardless; this only drives what the UI offers.
	ProviderAdminGroups []string

	// Backend connection.
	BackendAddress    string
	BackendCAFile     string
	BackendServerName string
	BackendTimeout    time.Duration

	// StaticAssetsDir holds the built frontend. Empty disables static serving.
	StaticAssetsDir string

	// GridEndpoint is the consumer-facing inference URL shown to admins.
	GridEndpoint string
	// MapTileURL is the tile server for the fleet map; empty hides the map.
	MapTileURL string
	// BillingURL is an external billing UI link; empty hides the menu item.
	BillingURL string

	LogLevel slog.Level
}

// Parse reads flags from args (without the program name) and environment variables.
func Parse(args []string, lookupEnv func(string) (string, bool)) (Config, error) {
	fs := flag.NewFlagSet("bff", flag.ContinueOnError)
	env := envReader{lookup: lookupEnv}

	var cfg Config
	var logLevel, adminGroups string

	fs.StringVar(&cfg.BindAddress, "bind-address", env.str("BIND_ADDRESS", ""), "Interface to listen on; empty for all")
	fs.IntVar(&cfg.Port, "port", env.int("PORT", 8080), "Listen port")
	fs.StringVar(&cfg.CertFile, "cert-file", env.str("CERT_FILE", ""), "TLS certificate file; enables TLS with key-file")
	fs.StringVar(&cfg.KeyFile, "key-file", env.str("KEY_FILE", ""), "TLS private key file")
	fs.StringVar(&cfg.AuthTokenHeader, "auth-token-header", env.str("AUTH_TOKEN_HEADER", DefaultAuthTokenHeader), "Header carrying the caller's bearer token")
	fs.StringVar(&cfg.AuthTokenPrefix, "auth-token-prefix", env.str("AUTH_TOKEN_PREFIX", ""), "Prefix to strip from the token header value")
	fs.StringVar(&cfg.AuthUserHeader, "auth-user-header", env.str("AUTH_USER_HEADER", DefaultAuthUserHeader), "Header carrying the caller's user name")
	fs.StringVar(&cfg.AuthEmailHeader, "auth-email-header", env.str("AUTH_EMAIL_HEADER", DefaultAuthEmailHeader), "Header carrying the caller's email")
	fs.StringVar(&cfg.AuthGroupsHeader, "auth-groups-header", env.str("AUTH_GROUPS_HEADER", DefaultAuthGroupsHeader), "Header carrying the caller's groups")
	fs.StringVar(&adminGroups, "provider-admin-groups", env.str("PROVIDER_ADMIN_GROUPS", ""), "Comma-separated groups shown provider-admin actions; empty for everyone")
	fs.StringVar(&cfg.BackendAddress, "backend-address", env.str("BACKEND_ADDRESS", DefaultBackendAddress), "ai-grid-backend gRPC address")
	fs.StringVar(&cfg.BackendCAFile, "backend-ca-file", env.str("BACKEND_CA_FILE", ""), "CA for TLS to the backend; empty for plaintext")
	fs.StringVar(&cfg.BackendServerName, "backend-server-name", env.str("BACKEND_SERVER_NAME", ""), "Expected TLS server name of the backend")
	fs.DurationVar(&cfg.BackendTimeout, "backend-timeout", env.duration("BACKEND_TIMEOUT", 10*time.Second), "Per-RPC timeout towards the backend")
	fs.StringVar(&cfg.StaticAssetsDir, "static-assets-dir", env.str("STATIC_ASSETS_DIR", ""), "Directory with the built frontend; empty disables")
	fs.StringVar(&cfg.GridEndpoint, "grid-endpoint", env.str("GRID_CONSUMER_URL", ""), "Consumer-facing AI Grid inference URL")
	fs.StringVar(&cfg.MapTileURL, "map-tile-url", env.str("MAP_TILE_URL", ""), "Tile server URL template for the fleet map")
	fs.StringVar(&cfg.BillingURL, "billing-url", env.str("BILLING_URL", ""), "External billing UI URL")
	fs.StringVar(&logLevel, "log-level", env.str("LOG_LEVEL", "info"), "Log level: debug, info, warn, error")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(logLevel)); err != nil {
		return Config{}, fmt.Errorf("invalid log level %q: %w", logLevel, err)
	}
	cfg.ProviderAdminGroups = splitList(adminGroups)
	if cfg.Port <= 0 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("invalid port %d", cfg.Port)
	}
	if (cfg.CertFile == "") != (cfg.KeyFile == "") {
		return Config{}, fmt.Errorf("cert-file and key-file must be set together")
	}
	for name, v := range map[string]string{"auth-token-header": cfg.AuthTokenHeader, "auth-user-header": cfg.AuthUserHeader, "backend-address": cfg.BackendAddress} {
		if strings.TrimSpace(v) == "" {
			return Config{}, fmt.Errorf("%s must not be empty", name)
		}
	}
	if cfg.BackendTimeout <= 0 {
		return Config{}, fmt.Errorf("backend-timeout must be positive")
	}
	return cfg, nil
}

// TLSEnabled reports whether the server should terminate TLS itself.
func (c Config) TLSEnabled() bool { return c.CertFile != "" && c.KeyFile != "" }

// ListenAddr is the address passed to the HTTP server.
func (c Config) ListenAddr() string { return fmt.Sprintf("%s:%d", c.BindAddress, c.Port) }

func splitList(s string) []string {
	var out []string
	for part := range strings.SplitSeq(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

type envReader struct {
	lookup func(string) (string, bool)
}

func (e envReader) str(key, fallback string) string {
	if v, ok := e.lookup(key); ok && v != "" {
		return v
	}
	return fallback
}

func (e envReader) int(key string, fallback int) int {
	if v, ok := e.lookup(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func (e envReader) duration(key string, fallback time.Duration) time.Duration {
	if v, ok := e.lookup(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

// OSLookupEnv adapts os.LookupEnv for Parse.
func OSLookupEnv(key string) (string, bool) { return os.LookupEnv(key) }
