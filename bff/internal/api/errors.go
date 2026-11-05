package api

import (
	"errors"
	"net/http"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/relay"
)

// statusError carries an HTTP status chosen by the handler.
type statusError struct {
	status  int
	message string
}

func (e *statusError) Error() string { return e.message }

// errHub marks a failed call to the hub API; the detail stays in the log.
var errHub = errors.New("hub request failed")

// Errorf builds an error that maps to a specific HTTP status.
func Errorf(status int, message string) error {
	return &statusError{status: status, message: message}
}

// respondError maps an error to a status and writes it.
func (a *App) respondError(w http.ResponseWriter, r *http.Request, err error) {
	code, message := classify(err)
	if code >= http.StatusInternalServerError {
		a.log(r).Error("request failed", "method", r.Method, "path", r.URL.Path, "status", code, "error", err)
	} else {
		a.log(r).Debug("request rejected", "method", r.Method, "path", r.URL.Path, "status", code, "error", err)
	}
	if relay.Handles(r.URL.Path) {
		// The provider-admin check in front of the Connect relay: the browser's
		// Connect client reads a Connect error, not the JSON API's envelope.
		relay.WriteError(w, code, message)
		return
	}
	writeError(w, code, message)
}

// classify maps a handler's error to HTTP: the caller checks' own statuses
// (statusError) and a failed hub access review (errHub), whose detail goes to
// the log. The BFF makes no gRPC call for a caller (the pages call the backend
// over Connect, through the relay), so no backend status reaches it.
func classify(err error) (int, string) {
	var se *statusError
	if errors.As(err, &se) {
		return se.status, se.message
	}
	// A hub that is too slow (hub.Config's timeout) is a hub failure too.
	if errors.Is(err, errHub) {
		return http.StatusBadGateway, "the hub could not confirm the caller's permissions; try again"
	}
	return http.StatusInternalServerError, "internal server error"
}
