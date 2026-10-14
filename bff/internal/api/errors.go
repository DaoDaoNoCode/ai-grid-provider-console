package api

import (
	"context"
	"errors"
	"net"
	"net/http"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// statusError carries an HTTP status chosen by the handler or repository.
type statusError struct {
	status  int
	message string
}

func (e *statusError) Error() string { return e.message }

// Errorf builds an error that maps to a specific HTTP status.
func Errorf(status int, message string) error {
	return &statusError{status: status, message: message}
}

func classify(err error) (int, string) {
	var se *statusError
	if errors.As(err, &se) {
		return se.status, se.message
	}

	var apiErr *apierrors.StatusError
	if errors.As(err, &apiErr) {
		code := int(apiErr.ErrStatus.Code)
		switch {
		case code == http.StatusUnauthorized:
			return code, "the cluster rejected the credentials; log in again"
		case code == http.StatusForbidden:
			return code, apiErr.ErrStatus.Message
		case code == http.StatusNotFound, code == http.StatusConflict, code == http.StatusGone, code == http.StatusPreconditionFailed:
			return code, apiErr.ErrStatus.Message
		case code == http.StatusBadRequest, code == http.StatusUnprocessableEntity:
			return http.StatusUnprocessableEntity, apiErr.ErrStatus.Message
		case code == http.StatusTooManyRequests:
			return code, "the cluster is rate limiting requests; try again shortly"
		case code >= http.StatusInternalServerError, code == 0:
			return http.StatusServiceUnavailable, "the cluster API is unavailable; try again"
		}
		return code, apiErr.ErrStatus.Message
	}

	var netErr net.Error
	if errors.As(err, &netErr) || errors.Is(err, context.DeadlineExceeded) {
		return http.StatusServiceUnavailable, "the cluster API could not be reached"
	}
	return http.StatusInternalServerError, "internal server error"
}
