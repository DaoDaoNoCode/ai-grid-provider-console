package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"reflect"
)

// maxBodyBytes bounds a JSON request body; a patch or a tenant is a handful
// of fields.
const maxBodyBytes = 1 << 20

// requireJSON is the first check of every handler that takes a body (every
// POST, PATCH and PUT): a Content-Type other than application/json
// (parameters such as charset are allowed) is 415, so a cross-site HTML form
// or a text/plain fetch, which a browser sends without a CORS preflight, can
// never write. A PATCH runs it before requireIfMatch, so such a request is
// 415 whatever its other headers say.
func requireJSON(r *http.Request) error {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return Errorf(http.StatusUnsupportedMediaType, "request body must be JSON: send Content-Type: application/json")
	}
	return nil
}

// decodeBody reads a JSON request body strictly: requireJSON, then exactly
// one JSON object (not null, an array or a scalar) of at most maxBodyBytes
// bytes with nothing after it, no unknown fields. A body that is too large is
// 413 (also when the excess is after the value); anything else wrong with it
// is 422 with a message that names the problem. The body is fully validated
// before any backend call.
func decodeBody(w http.ResponseWriter, r *http.Request, into any) error {
	if err := requireJSON(r); err != nil {
		return err
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err := decodeObject(dec, into); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return Errorf(http.StatusRequestEntityTooLarge, fmt.Sprintf("request body must not exceed %d bytes", maxBodyBytes))
		}
		return Errorf(http.StatusUnprocessableEntity, fmt.Sprintf("invalid request body: %s", decodeErrorMessage(err)))
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return Errorf(http.StatusRequestEntityTooLarge, fmt.Sprintf("request body must not exceed %d bytes", maxBodyBytes))
		}
		return Errorf(http.StatusUnprocessableEntity, "invalid request body: unexpected content after the JSON object")
	}
	return nil
}

// errNotObject is the decode error for a body that is valid JSON but not an
// object; decodeErrorMessage passes its text through.
var errNotObject = errors.New("must be a JSON object")

// decodeObject decodes the next JSON value from dec into `into` and requires it
// to be an object with no unknown fields. A struct target would otherwise take
// a top-level null as "no fields set" (and an empty PATCH answers 200), and an
// array or a scalar would fail with a type message that names no field.
func decodeObject(dec *json.Decoder, into any) error {
	var raw json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	if len(raw) == 0 || raw[0] != '{' {
		return errNotObject
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	return strict.Decode(into)
}

// decodeErrorMessage keeps the useful part of a JSON decoding error.
// jsonKind names a Go type the way a JSON client knows it ("an object", "a
// string"), so a type error never shows the BFF's internal type names.
func jsonKind(t reflect.Type) string {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Struct, reflect.Map:
		return "an object"
	case reflect.Slice, reflect.Array:
		return "an array"
	case reflect.String:
		return "a string"
	case reflect.Bool:
		return "true or false"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "a whole number"
	case reflect.Float32, reflect.Float64:
		return "a number"
	}
	return "a different JSON type"
}

func decodeErrorMessage(err error) string {
	var syntax *json.SyntaxError
	var typ *json.UnmarshalTypeError
	switch {
	case errors.As(err, &syntax), errors.Is(err, io.ErrUnexpectedEOF):
		return "malformed JSON"
	case errors.As(err, &typ):
		return fmt.Sprintf("field %q must be %s", typ.Field, jsonKind(typ.Type))
	case errors.Is(err, io.EOF):
		return "empty body"
	}
	return err.Error()
}
