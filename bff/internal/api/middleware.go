package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/hub"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/identity"
)

// requireIdentity rejects API calls without a caller token and stores the
// identity on the context so the backend client can forward it.
func (a *App) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := a.headers.Extract(r.Header)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		next.ServeHTTP(w, r.WithContext(identity.WithIdentity(r.Context(), id)))
	})
}

// requireProviderAdmin lets a call through only when the hub says the caller
// may patch ManagedClusters (hub.ProviderAdminCheck, asked with the caller's
// own token), reads as well as writes. The backend acts with its own
// ServiceAccount and authorizes nothing yet, and kube-auth-proxy admits any
// OpenShift login, so without this any signed-in user could read every
// cluster and tenant and write through the backend's rights. GET /user and
// GET /config stay open: the UI needs them to say who the caller is.
func (a *App) requireProviderAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && (r.URL.Path == APIPrefix+"/user" || r.URL.Path == APIPrefix+"/config") {
			next.ServeHTTP(w, r)
			return
		}
		id, _ := identity.FromContext(r.Context())
		allowed, err := a.hub.CanI(r.Context(), id.Token(), hub.ProviderAdminCheck)
		switch {
		case errors.Is(err, hub.ErrUnauthorized):
			a.respondError(w, r, Errorf(http.StatusUnauthorized, "the hub rejected the credentials; log in again"))
		case err != nil:
			a.respondError(w, r, fmt.Errorf("%w: provider-admin check for %s: %w", errHub, id.Username, err))
		case !allowed:
			a.respondError(w, r, Errorf(http.StatusForbidden, "the console is for provider admins: the hub says you may not patch ManagedClusters"))
		default:
			next.ServeHTTP(w, r)
		}
	})
}

// recoverPanic turns a panic into a 500 and logs the stack. A panic after the
// answer was under way (committedPanic, from compress) is logged the same way,
// but the connection is cut instead: the 500 can no longer be sent.
func (a *App) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
				// A handler aborting an answer it already started (the Perses relay when
				// the browser goes away or Perses stops mid-answer): net/http closes the
				// connection without logging it, and a 500 can no longer be sent.
				// logRequests has logged the request as aborted.
				panic(http.ErrAbortHandler)
			}
			committed, isCommitted := rec.(committedPanic)
			if isCommitted {
				rec = committed.value
			}
			a.logger.Error("panic serving request", "method", r.Method, "path", r.URL.Path, "panic", fmt.Sprint(rec), "stack", string(debug.Stack()))
			if isCommitted {
				panic(http.ErrAbortHandler)
			}
			w.Header().Set("Connection", "close")
			writeError(w, http.StatusInternalServerError, "internal server error")
		}()
		next.ServeHTTP(w, r)
	})
}

// committedPanic is a panic after the answer's status reached the connection,
// as compress passes it on: value is what the handler panicked with.
type committedPanic struct{ value any }

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController (the relay's flushes, gzipWriter's)
// reach the connection's writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// logRequests emits one line per request with a request id the client also gets. A handler
// that panics (an aborted answer, or a bug recoverPanic turns into a 500) still gets its line,
// as "request aborted" with the status sent so far.
func (a *App) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := newRequestID()
		w.Header().Set("X-Request-Id", reqID)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		completed := false
		defer func() {
			// No recover here: the panic goes on to recoverPanic with its stack intact.
			if !completed {
				a.logger.Warn("request aborted", "id", reqID, "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start).Round(time.Millisecond))
			}
		}()
		next.ServeHTTP(rec, r)
		completed = true
		a.logger.Info("request", "id", reqID, "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start).Round(time.Millisecond))
	})
}

func newRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
