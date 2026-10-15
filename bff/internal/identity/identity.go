// Package identity reads who is calling from the headers set by the login proxy.
//
// In a cluster, kube-auth-proxy runs in front of the BFF and sets the user's
// name, groups and OpenShift access token on every request. Locally the Vite
// dev proxy sets the same headers from `oc whoami`. The BFF does not verify
// these headers itself: it is only reachable through the proxy, and the
// backend enforces authorization with the forwarded token.
package identity

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// Identity is what the proxy told the BFF about the caller.
type Identity struct {
	Username string
	Email    string
	Groups   []string
	token    string
}

// Token returns the caller's bearer token, forwarded to the backend.
func (i Identity) Token() string { return i.token }

// String hides the token from logs and error messages.
func (i Identity) String() string {
	return fmt.Sprintf("Identity{user:%q groups:%d token:[REDACTED]}", i.Username, len(i.Groups))
}

// Headers names the proxy headers to read.
type Headers struct {
	User        string
	Email       string
	Groups      string
	Token       string
	TokenPrefix string
}

// Extract builds an Identity from request headers. The token is required; the
// other headers are optional because API clients that send a bearer token
// directly to the proxy may not have them set.
func (h Headers) Extract(header http.Header) (Identity, error) {
	raw := strings.TrimSpace(header.Get(h.Token))
	if raw == "" {
		return Identity{}, fmt.Errorf("missing %s header", h.Token)
	}
	if h.TokenPrefix != "" {
		if !strings.HasPrefix(raw, h.TokenPrefix) {
			return Identity{}, fmt.Errorf("%s header must start with %q", h.Token, h.TokenPrefix)
		}
		raw = strings.TrimSpace(strings.TrimPrefix(raw, h.TokenPrefix))
	}
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return Identity{}, fmt.Errorf("%s header does not contain a valid token", h.Token)
	}
	id := Identity{
		Username: strings.TrimSpace(header.Get(h.User)),
		Email:    strings.TrimSpace(header.Get(h.Email)),
		Groups:   splitGroups(header.Values(h.Groups)),
		token:    raw,
	}
	return id, nil
}

// splitGroups accepts repeated headers and comma-separated values.
func splitGroups(values []string) []string {
	var out []string
	for _, v := range values {
		for g := range strings.SplitSeq(v, ",") {
			if g = strings.TrimSpace(g); g != "" {
				out = append(out, g)
			}
		}
	}
	return out
}

type contextKey struct{}

// WithIdentity stores the identity on the context.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// FromContext returns the identity stored by WithIdentity.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(contextKey{}).(Identity)
	return id, ok && id.token != ""
}
