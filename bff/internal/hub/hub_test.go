package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeHub answers SelfSubjectAccessReviews the way an API server does and
// records what it was asked.
type fakeHub struct {
	t       *testing.T
	allowed bool
	status  int
	gotAuth string
	gotBody accessReview
}

func (f *fakeHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews" {
		f.t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	f.gotAuth = r.Header.Get("Authorization")
	if err := json.NewDecoder(r.Body).Decode(&f.gotBody); err != nil {
		f.t.Errorf("decode body: %v", err)
	}
	if f.status != 0 {
		http.Error(w, http.StatusText(f.status), f.status)
		return
	}
	f.gotBody.Status.Allowed = f.allowed
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(f.gotBody)
}

func newClient(t *testing.T, f *fakeHub) *Client {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	c, err := New(Config{URL: srv.URL + "/"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCanISendsTokenAndAttributes(t *testing.T) {
	f := &fakeHub{t: t, allowed: true}
	c := newClient(t, f)
	ok, err := c.CanI(context.Background(), "sha256~abc", ProviderAdminCheck)
	if err != nil || !ok {
		t.Fatalf("CanI = %v, %v", ok, err)
	}
	if f.gotAuth != "Bearer sha256~abc" {
		t.Errorf("Authorization = %q", f.gotAuth)
	}
	if f.gotBody.Kind != "SelfSubjectAccessReview" || f.gotBody.Spec.ResourceAttributes != ProviderAdminCheck {
		t.Errorf("body = %+v", f.gotBody)
	}
}

func TestCanIDenied(t *testing.T) {
	c := newClient(t, &fakeHub{t: t, allowed: false})
	ok, err := c.CanI(context.Background(), "tok", ProviderAdminCheck)
	if err != nil || ok {
		t.Fatalf("CanI = %v, %v, want false", ok, err)
	}
}

func TestCanIErrors(t *testing.T) {
	c := newClient(t, &fakeHub{t: t, status: http.StatusUnauthorized})
	if _, err := c.CanI(context.Background(), "expired", ProviderAdminCheck); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("401 should map to ErrUnauthorized, got %v", err)
	}
	if _, err := c.CanI(context.Background(), "", ProviderAdminCheck); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("empty token should be ErrUnauthorized, got %v", err)
	}
	c = newClient(t, &fakeHub{t: t, status: http.StatusInternalServerError})
	if _, err := c.CanI(context.Background(), "tok", ProviderAdminCheck); err == nil || strings.Contains(err.Error(), "tok") {
		t.Errorf("5xx should fail without leaking the token, got %v", err)
	}
}

func TestNewValidates(t *testing.T) {
	if _, err := New(Config{}); err == nil {
		t.Error("empty URL should fail")
	}
	if _, err := New(Config{URL: "api.example.com"}); err == nil {
		t.Error("URL without scheme should fail")
	}
	if _, err := New(Config{URL: "https://api.example.com", CAFile: "/nonexistent/ca.crt"}); err == nil {
		t.Error("missing CA file should fail")
	}
	c, err := New(Config{URL: "https://api.example.com:443/"})
	if err != nil || c.URL() != "https://api.example.com:443" {
		t.Errorf("New = %v, %v", c, err)
	}
}
