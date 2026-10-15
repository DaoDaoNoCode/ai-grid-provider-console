package api

import (
	"context"
	"errors"
	"net/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
		a.logger.Error("request failed", "method", r.Method, "path", r.URL.Path, "status", code, "error", err)
	} else {
		a.logger.Debug("request rejected", "method", r.Method, "path", r.URL.Path, "status", code, "error", err)
	}
	writeError(w, code, message)
}

// classify maps handler and gRPC errors to HTTP. The backend's message is kept
// for client-caused failures so the user sees what it said; infrastructure
// failures get a generic message and the detail goes to the log.
func classify(err error) (int, string) {
	var se *statusError
	if errors.As(err, &se) {
		return se.status, se.message
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusGatewayTimeout, "the AI Grid backend did not answer in time"
	}
	if errors.Is(err, errHub) {
		return http.StatusBadGateway, "the hub could not confirm the caller's permissions; try again"
	}
	if st, ok := status.FromError(err); ok {
		msg := st.Message()
		switch st.Code() {
		case codes.InvalidArgument, codes.OutOfRange:
			return http.StatusUnprocessableEntity, msg
		case codes.Unauthenticated:
			return http.StatusUnauthorized, "the AI Grid backend rejected the credentials; log in again"
		case codes.PermissionDenied:
			return http.StatusForbidden, msg
		case codes.NotFound:
			return http.StatusNotFound, msg
		case codes.AlreadyExists, codes.Aborted:
			return http.StatusConflict, msg
		case codes.FailedPrecondition:
			return http.StatusPreconditionFailed, msg
		case codes.ResourceExhausted:
			return http.StatusTooManyRequests, "the AI Grid backend is rate limiting requests; try again shortly"
		case codes.Unimplemented:
			return http.StatusNotImplemented, "the AI Grid backend does not support this operation yet"
		case codes.DeadlineExceeded:
			return http.StatusGatewayTimeout, "the AI Grid backend did not answer in time"
		case codes.Unavailable, codes.Canceled:
			return http.StatusServiceUnavailable, "the AI Grid backend is unavailable; try again"
		case codes.OK:
			return http.StatusInternalServerError, "internal server error"
		}
		return http.StatusBadGateway, "the AI Grid backend failed to process the request"
	}
	return http.StatusInternalServerError, "internal server error"
}
