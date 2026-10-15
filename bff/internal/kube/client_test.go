package kube

import (
	"context"
	"log/slog"
	"net/http"
	"testing"

	"k8s.io/client-go/rest"
)

func TestHeaderExtractor(t *testing.T) {
	cases := []struct {
		name    string
		header  http.Header
		prefix  string
		want    string
		wantErr bool
	}{
		{name: "raw token", header: http.Header{"X-Forwarded-Access-Token": {"sha256~abc"}}, want: "sha256~abc"},
		{name: "bearer prefix", header: http.Header{"X-Forwarded-Access-Token": {"Bearer sha256~abc"}}, prefix: "Bearer ", want: "sha256~abc"},
		{name: "missing", header: http.Header{}, wantErr: true},
		{name: "blank", header: http.Header{"X-Forwarded-Access-Token": {"   "}}, wantErr: true},
		{name: "wrong prefix", header: http.Header{"X-Forwarded-Access-Token": {"Basic abc"}}, prefix: "Bearer ", wantErr: true},
		{name: "whitespace inside", header: http.Header{"X-Forwarded-Access-Token": {"a b"}}, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, err := HeaderExtractor{Header: "x-forwarded-access-token", Prefix: tc.prefix}.Extract(tc.header)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got identity %v", id)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if id.Token() != tc.want {
				t.Fatalf("token = %q, want %q", id.Token(), tc.want)
			}
		})
	}
}

func TestIdentityDoesNotLeakToken(t *testing.T) {
	id := NewIdentity("sha256~secret")
	if s := id.String(); s != "Identity{token:[REDACTED]}" {
		t.Fatalf("String() = %q", s)
	}
}

func TestTokenClientFactoryDropsBaseCredentials(t *testing.T) {
	base := &rest.Config{Host: "https://api.example.com:6443", BearerToken: "kubeconfig-token", Username: "u", Password: "p"}
	f := newTokenClientFactory(slog.New(slog.DiscardHandler), base, Options{})
	if f.base.BearerToken != "" || f.base.Username != "" || f.base.Password != "" {
		t.Fatal("base credentials should be discarded")
	}
	if f.Host() != base.Host {
		t.Fatalf("Host = %q", f.Host())
	}

	if _, err := f.ClientFor(context.Background()); err == nil {
		t.Fatal("ClientFor without identity should fail")
	}
	ctx := WithIdentity(context.Background(), NewIdentity("user-token"))
	c, err := f.ClientFor(ctx)
	if err != nil {
		t.Fatalf("ClientFor: %v", err)
	}
	if c.Kube == nil || c.Dynamic == nil {
		t.Fatal("clients should be built")
	}
	if f.base.BearerToken != "" {
		t.Fatal("per-request token must not be written back to the shared base config")
	}
}

func TestInsecureOption(t *testing.T) {
	base := &rest.Config{Host: "https://api.example.com:6443", TLSClientConfig: rest.TLSClientConfig{CAData: []byte("ca")}}
	f := newTokenClientFactory(slog.New(slog.DiscardHandler), base, Options{InsecureSkipVerify: true})
	if !f.base.Insecure || f.base.CAData != nil {
		t.Fatal("insecure option should drop CA data and set Insecure")
	}
}
