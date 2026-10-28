package identity

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

var headers = Headers{User: "x-forwarded-user", Email: "x-forwarded-email", Groups: "x-forwarded-groups", Token: "x-forwarded-access-token"}

func TestExtract(t *testing.T) {
	t.Parallel()
	h := http.Header{}
	h.Set("X-Forwarded-Access-Token", "sha256~abc")
	h.Set("X-Forwarded-User", "alice")
	h.Set("X-Forwarded-Email", "alice@example.com")
	h.Add("X-Forwarded-Groups", "system:authenticated, cluster-admins")
	h.Add("X-Forwarded-Groups", "ai-grid-admins")

	id, err := headers.Extract(h)
	if err != nil {
		t.Fatal(err)
	}
	if id.Username != "alice" || id.Email != "alice@example.com" || id.Token() != "sha256~abc" {
		t.Fatalf("unexpected identity %+v", id)
	}
	if got := strings.Join(id.Groups, "|"); got != "system:authenticated|cluster-admins|ai-grid-admins" {
		t.Fatalf("groups = %q", got)
	}
	if s := id.String(); strings.Contains(s, "abc") || !strings.Contains(s, "alice") {
		t.Fatalf("String leaks token or hides user: %s", s)
	}
}

func TestExtractErrors(t *testing.T) {
	t.Parallel()
	cases := map[string]http.Header{
		"missing":    {},
		"whitespace": {"X-Forwarded-Access-Token": {"a b"}},
		"empty":      {"X-Forwarded-Access-Token": {"   "}},
	}
	for name, h := range cases {
		if _, err := headers.Extract(h); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	prefixed := Headers{Token: "authorization", TokenPrefix: "Bearer "}
	if _, err := prefixed.Extract(http.Header{"Authorization": {"Basic xyz"}}); err == nil {
		t.Error("wrong prefix accepted")
	}
	id, err := prefixed.Extract(http.Header{"Authorization": {"Bearer tok"}})
	if err != nil || id.Token() != "tok" {
		t.Fatalf("prefix not stripped: %v %v", id, err)
	}
}

func TestContext(t *testing.T) {
	t.Parallel()
	if _, ok := FromContext(context.Background()); ok {
		t.Fatal("empty context reported an identity")
	}
	ctx := WithIdentity(context.Background(), Identity{Username: "bob", token: "t"})
	id, ok := FromContext(ctx)
	if !ok || id.Username != "bob" {
		t.Fatalf("round trip failed: %v %v", id, ok)
	}
}
