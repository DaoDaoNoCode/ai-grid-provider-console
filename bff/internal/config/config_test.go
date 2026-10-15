package config

import (
	"strings"
	"testing"
	"time"
)

func lookup(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		v, ok := values[key]
		return v, ok
	}
}

func TestParseDefaults(t *testing.T) {
	cfg, err := Parse(nil, lookup(nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 8080 || cfg.AuthTokenHeader != DefaultAuthTokenHeader || cfg.AuthUserHeader != DefaultAuthUserHeader || cfg.BackendAddress != DefaultBackendAddress {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.BackendTimeout != 10*time.Second || len(cfg.ProviderAdminGroups) != 0 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.TLSEnabled() {
		t.Fatal("TLS should be disabled by default")
	}
	if got := cfg.ListenAddr(); got != ":8080" {
		t.Fatalf("ListenAddr = %q", got)
	}
}

func TestParseEnvThenFlags(t *testing.T) {
	env := map[string]string{"PORT": "9000", "BACKEND_ADDRESS": "from-env:1", "LOG_LEVEL": "debug", "BACKEND_TIMEOUT": "3s", "PROVIDER_ADMIN_GROUPS": "a, b,,c"}
	cfg, err := Parse([]string{"--backend-address=from-flag:2"}, lookup(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 9000 {
		t.Errorf("Port = %d, want 9000 from env", cfg.Port)
	}
	if cfg.BackendAddress != "from-flag:2" {
		t.Errorf("BackendAddress = %q, flag should win over env", cfg.BackendAddress)
	}
	if cfg.BackendTimeout != 3*time.Second {
		t.Errorf("BackendTimeout = %s", cfg.BackendTimeout)
	}
	if got := strings.Join(cfg.ProviderAdminGroups, "|"); got != "a|b|c" {
		t.Errorf("ProviderAdminGroups = %q", got)
	}
	if cfg.LogLevel.String() != "DEBUG" {
		t.Errorf("LogLevel = %s", cfg.LogLevel)
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	cases := [][]string{
		{"--port=0"},
		{"--cert-file=only-cert"},
		{"--auth-token-header="},
		{"--auth-user-header= "},
		{"--backend-address="},
		{"--backend-timeout=0"},
		{"--log-level=loud"},
	}
	for _, args := range cases {
		if _, err := Parse(args, lookup(nil)); err == nil {
			t.Errorf("Parse(%v) should fail", args)
		}
	}
}
