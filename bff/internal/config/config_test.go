package config

import "testing"

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
	if cfg.Port != 8080 || cfg.AuthTokenHeader != DefaultAuthTokenHeader || cfg.HubNamespace != DefaultHubNamespace {
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
	env := map[string]string{"PORT": "9000", "HUB_NAMESPACE": "from-env", "LOG_LEVEL": "debug", "INSECURE_SKIP_VERIFY": "true"}
	cfg, err := Parse([]string{"--hub-namespace=from-flag"}, lookup(env))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != 9000 {
		t.Errorf("Port = %d, want 9000 from env", cfg.Port)
	}
	if cfg.HubNamespace != "from-flag" {
		t.Errorf("HubNamespace = %q, flag should win over env", cfg.HubNamespace)
	}
	if !cfg.InsecureSkipVerify {
		t.Error("InsecureSkipVerify should be true from env")
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
		{"--log-level=loud"},
	}
	for _, args := range cases {
		if _, err := Parse(args, lookup(nil)); err == nil {
			t.Errorf("Parse(%v) should fail", args)
		}
	}
}
