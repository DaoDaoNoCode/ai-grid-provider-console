package fakebackend

import (
	"log/slog"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fixedNow is the clock of newRepoServer.
var fixedNow = time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)

// newRepoServer is a server on the shipped fixtures whose clock stands still
// at fixedNow.
func newRepoServer(t *testing.T) *Server {
	t.Helper()
	fx, err := Load(repoFixtures)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(fx, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	s.SetClock(func() time.Time { return fixedNow })
	return s
}

// mustCode fails the test unless err has the code want and, when wantMsg is
// set, that message.
func mustCode(t *testing.T, err error, want codes.Code, wantMsg string) {
	t.Helper()
	if status.Code(err) != want {
		t.Fatalf("code = %v (%v), want %v", status.Code(err), err, want)
	}
	if wantMsg != "" && status.Convert(err).Message() != wantMsg {
		t.Fatalf("message = %q, want %q", status.Convert(err).Message(), wantMsg)
	}
}
