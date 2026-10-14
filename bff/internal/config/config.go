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
)

const (
	// DefaultAuthTokenHeader is the header kube-auth-proxy uses when started with
	// --pass-access-token. The frontend dev proxy sets the same header.
	DefaultAuthTokenHeader = "x-forwarded-access-token"
	// DefaultHubNamespace is where the console writes its own hub resources
	// (Placements, ManifestWorkReplicaSets, MaaSModelRefs).
	DefaultHubNamespace = "ai-grid"
)

// Config is the fully resolved BFF configuration.
type Config struct {
	// BindAddress is the host part of the listen address. Empty binds all interfaces.
	BindAddress string
	Port        int
	// CertFile and KeyFile enable TLS when both are set.
	CertFile string
	KeyFile  string

	// AuthTokenHeader carries the caller's OpenShift bearer token.
	AuthTokenHeader string
	// AuthTokenPrefix is stripped from the header value, for example "Bearer ".
	AuthTokenPrefix string

	// StaticAssetsDir holds the built frontend. Empty disables static serving.
	StaticAssetsDir string

	// HubNamespace is the namespace for console-owned hub resources.
	HubNamespace string
	// GridEndpoint is the consumer-facing inference URL shown to admins.
	GridEndpoint string
	// MapTileURL is the tile server for the fleet map; empty hides the map.
	MapTileURL string
	// BillingURL is an external billing UI link; empty hides the menu item.
	BillingURL string

	// InsecureSkipVerify disables TLS verification towards the API server (dev only).
	InsecureSkipVerify bool
	LogLevel           slog.Level
}

// Parse reads flags from args (without the program name) and environment variables.
func Parse(args []string, lookupEnv func(string) (string, bool)) (Config, error) {
	fs := flag.NewFlagSet("bff", flag.ContinueOnError)
	env := envReader{lookup: lookupEnv}

	var cfg Config
	var logLevel string

	fs.StringVar(&cfg.BindAddress, "bind-address", env.str("BIND_ADDRESS", ""), "Interface to listen on; empty for all")
	fs.IntVar(&cfg.Port, "port", env.int("PORT", 8080), "Listen port")
	fs.StringVar(&cfg.CertFile, "cert-file", env.str("CERT_FILE", ""), "TLS certificate file; enables TLS with key-file")
	fs.StringVar(&cfg.KeyFile, "key-file", env.str("KEY_FILE", ""), "TLS private key file")
	fs.StringVar(&cfg.AuthTokenHeader, "auth-token-header", env.str("AUTH_TOKEN_HEADER", DefaultAuthTokenHeader), "Header carrying the caller's bearer token")
	fs.StringVar(&cfg.AuthTokenPrefix, "auth-token-prefix", env.str("AUTH_TOKEN_PREFIX", ""), "Prefix to strip from the token header value")
	fs.StringVar(&cfg.StaticAssetsDir, "static-assets-dir", env.str("STATIC_ASSETS_DIR", ""), "Directory with the built frontend; empty disables")
	fs.StringVar(&cfg.HubNamespace, "hub-namespace", env.str("HUB_NAMESPACE", DefaultHubNamespace), "Namespace for console-owned hub resources")
	fs.StringVar(&cfg.GridEndpoint, "grid-endpoint", env.str("GRID_CONSUMER_URL", ""), "Consumer-facing AI Grid inference URL")
	fs.StringVar(&cfg.MapTileURL, "map-tile-url", env.str("MAP_TILE_URL", ""), "Tile server URL template for the fleet map")
	fs.StringVar(&cfg.BillingURL, "billing-url", env.str("BILLING_URL", ""), "External billing UI URL")
	fs.BoolVar(&cfg.InsecureSkipVerify, "insecure-skip-verify", env.boolean("INSECURE_SKIP_VERIFY", false), "Skip TLS verification towards the API server (development only)")
	fs.StringVar(&logLevel, "log-level", env.str("LOG_LEVEL", "info"), "Log level: debug, info, warn, error")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(logLevel)); err != nil {
		return Config{}, fmt.Errorf("invalid log level %q: %w", logLevel, err)
	}
	if cfg.Port <= 0 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("invalid port %d", cfg.Port)
	}
	if (cfg.CertFile == "") != (cfg.KeyFile == "") {
		return Config{}, fmt.Errorf("cert-file and key-file must be set together")
	}
	if strings.TrimSpace(cfg.AuthTokenHeader) == "" {
		return Config{}, fmt.Errorf("auth-token-header must not be empty")
	}
	if strings.TrimSpace(cfg.HubNamespace) == "" {
		return Config{}, fmt.Errorf("hub-namespace must not be empty")
	}
	return cfg, nil
}

// TLSEnabled reports whether the server should terminate TLS itself.
func (c Config) TLSEnabled() bool { return c.CertFile != "" && c.KeyFile != "" }

// ListenAddr is the address passed to the HTTP server.
func (c Config) ListenAddr() string { return fmt.Sprintf("%s:%d", c.BindAddress, c.Port) }

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

func (e envReader) boolean(key string, fallback bool) bool {
	if v, ok := e.lookup(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

// OSLookupEnv adapts os.LookupEnv for Parse.
func OSLookupEnv(key string) (string, bool) { return os.LookupEnv(key) }
