// Package kube builds Kubernetes clients that act as the calling user.
//
// Every API request carries the caller's OpenShift bearer token in a header set
// by kube-auth-proxy (in the cluster) or by the dev proxy (locally). The BFF never
// uses a credential of its own: the API server enforces RBAC per user.
package kube

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// Identity is what the BFF knows about the caller before talking to Kubernetes.
type Identity struct {
	token string
}

// NewIdentity wraps a bearer token. The token is never printed by %v or logging.
func NewIdentity(token string) *Identity { return &Identity{token: token} }

// Token returns the raw bearer token.
func (i *Identity) Token() string { return i.token }

// String hides the token from logs and error messages.
func (i *Identity) String() string { return "Identity{token:[REDACTED]}" }

type contextKey struct{}

// WithIdentity stores the identity on the context.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// IdentityFrom returns the identity stored by WithIdentity.
func IdentityFrom(ctx context.Context) (*Identity, bool) {
	id, ok := ctx.Value(contextKey{}).(*Identity)
	return id, ok && id != nil && id.token != ""
}

// HeaderExtractor reads the bearer token from a configurable header.
type HeaderExtractor struct {
	Header string
	Prefix string
}

// Extract returns the identity carried by the request headers.
func (e HeaderExtractor) Extract(h http.Header) (*Identity, error) {
	raw := strings.TrimSpace(h.Get(e.Header))
	if raw == "" {
		return nil, fmt.Errorf("missing %s header", e.Header)
	}
	if e.Prefix != "" {
		if !strings.HasPrefix(raw, e.Prefix) {
			return nil, fmt.Errorf("%s header must start with %q", e.Header, e.Prefix)
		}
		raw = strings.TrimSpace(strings.TrimPrefix(raw, e.Prefix))
	}
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return nil, fmt.Errorf("%s header does not contain a valid token", e.Header)
	}
	return NewIdentity(raw), nil
}
