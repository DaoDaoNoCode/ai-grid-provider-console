package config

import (
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
	cfg, err := Parse([]string{"--hub-api-url=https://hub.example:6443"}, lookup(nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 8080 || cfg.AuthTokenHeader != DefaultAuthTokenHeader || cfg.AuthUserHeader != DefaultAuthUserHeader || cfg.BackendAddress != DefaultBackendAddress {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.BackendTimeout != 10*time.Second || cfg.BindAddress != DefaultBindAddress || cfg.HubCAFile != "" || cfg.ModelsNamespace != DefaultModelsNamespace || DefaultModelsNamespace != "ai-grid-models" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.TLSEnabled() {
		t.Fatal("TLS should be disabled by default")
	}
	if got := cfg.ListenAddr(); got != "127.0.0.1:8080" {
		t.Fatalf("ListenAddr = %q, the BFF must stay on loopback by default", got)
	}
}

func TestParseInClusterDefaults(t *testing.T) {
	env := map[string]string{"KUBERNETES_SERVICE_HOST": "10.0.0.1", "KUBERNETES_SERVICE_PORT": "443"}
	cfg, err := Parse(nil, lookup(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HubAPIURL != "https://10.0.0.1:443" || cfg.HubCAFile != DefaultHubCAFile {
		t.Fatalf("in-cluster hub defaults: %+v", cfg)
	}
	env["HUB_API_URL"] = "https://hub.example"
	env["HUB_CA_FILE"] = ""
	cfg, err = Parse([]string{"--hub-ca-file=/tmp/ca.crt"}, lookup(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HubAPIURL != "https://hub.example" || cfg.HubCAFile != "/tmp/ca.crt" {
		t.Fatalf("overrides should win: %+v", cfg)
	}
}

func TestParseEnvThenFlags(t *testing.T) {
	env := map[string]string{"PORT": "9000", "BACKEND_ADDRESS": "from-env:1", "LOG_LEVEL": "debug", "BACKEND_TIMEOUT": "3s", "HUB_API_URL": "https://hub.example", "BIND_ADDRESS": "0.0.0.0", "MODELS_NAMESPACE": "team-models"}
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
	if cfg.ListenAddr() != "0.0.0.0:9000" {
		t.Errorf("ListenAddr = %q", cfg.ListenAddr())
	}
	if cfg.ModelsNamespace != "team-models" {
		t.Errorf("ModelsNamespace = %q", cfg.ModelsNamespace)
	}
	if cfg.LogLevel.String() != "DEBUG" {
		t.Errorf("LogLevel = %s", cfg.LogLevel)
	}
}

func TestParsePerses(t *testing.T) {
	hub := "--hub-api-url=https://hub.example"
	cfg, err := Parse([]string{hub}, lookup(nil))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.PersesURL != "" || cfg.PersesTimeout != 30*time.Second {
		t.Fatalf("Monitoring should be off by default with a 30s timeout: %+v", cfg)
	}
	env := map[string]string{
		"PERSES_URL": "https://perses.example:8080", "PERSES_CA_FILE": "/ca.crt", "PERSES_SERVER_NAME": "perses.ns.svc",
		"PERSES_INSECURE": "true", "PERSES_TIMEOUT": "5s", "PERSES_PROJECT": "ai-grid",
	}
	cfg, err = Parse([]string{hub, "--perses-project=from-flag"}, lookup(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.PersesURL != "https://perses.example:8080" || cfg.PersesCAFile != "/ca.crt" || cfg.PersesServerName != "perses.ns.svc" ||
		!cfg.PersesInsecure || cfg.PersesTimeout != 5*time.Second || cfg.PersesProject != "from-flag" {
		t.Fatalf("Perses settings from env, flag winning: %+v", cfg)
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	hub := "--hub-api-url=https://hub.example"
	cases := [][]string{
		{"--port=0", hub},
		{"--cert-file=only-cert", hub},
		{"--auth-token-header=", hub},
		{"--auth-user-header= ", hub},
		{"--backend-address=", hub},
		{"--backend-timeout=0", hub},
		{"--perses-timeout=0", hub},
		{"--log-level=loud", hub},
		{}, // no hub API URL outside a pod
	}
	for _, args := range cases {
		if _, err := Parse(args, lookup(nil)); err == nil {
			t.Errorf("Parse(%v) should fail", args)
		}
	}
}
