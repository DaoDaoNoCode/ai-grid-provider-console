package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// envelope wraps every successful JSON response. List endpoints that page
// add `meta`; everything else has `data` only.
type envelope struct {
	Data any       `json:"data"`
	Meta *ListMeta `json:"meta,omitempty"`
}

// ListMeta describes one page of a paged list: how many items came back,
// how many match in total, and the offset and limit that were applied.
// Limit is omitted when the caller asked for everything; Total is omitted
// when it is not known (see listMeta).
type ListMeta struct {
	Size   int  `json:"size"`
	Total  *int `json:"total,omitempty"`
	Offset int  `json:"offset"`
	Limit  *int `json:"limit,omitempty"`
}

// listMeta builds the page description from the request's offset and limit
// and the backend's answer. `total` is the backend's count when it sent one.
// A backend that sends none does not count, so the BFF reports what it can
// prove, the items before this page plus this page (offset+size), and omits
// the total when the page is full (size == limit), because more may follow.
// The handlers only get here without a total when the caller asked for no
// filter, offset or limit (see requireTotal), so today that bound is the size.
func listMeta(offset, limit *int, size int, total *int32) ListMeta {
	meta := ListMeta{Size: size, Limit: limit}
	if offset != nil {
		meta.Offset = *offset
	}
	switch {
	case total != nil:
		meta.Total = intPtr(int(*total))
	case limit == nil || size < *limit:
		meta.Total = intPtr(meta.Offset + size)
	}
	return meta
}

func intPtr(v int) *int { return &v }

// requireTotal refuses a filter or a page the backend did not honour. A list
// response without `total` comes from a backend that ignores `offset`,
// `limit` and `filter` (the shipped one: its ListTenantsRequest is empty, so
// the fields are dropped as unknown on the wire), and its rows are the
// unfiltered first page, not the result the caller asked for. Showing them
// as filtered results would be wrong data, so the answer is 501 with a
// message that says which feature is missing. This is transport
// compatibility with the shipped backend, not a check of the filter: the BFF
// only notices that the answer carries no count.
func requireTotal(asked bool, total *int32, what string) error {
	if asked && total == nil {
		return Errorf(http.StatusNotImplemented, fmt.Sprintf("the AI Grid backend does not support filtering or paging %s yet; list them without filter, offset or limit", what))
	}
	return nil
}

// setETag sends the object's version as a strong entity tag, so a client can
// send it back in If-Match on the write that follows. Nothing is sent for an
// empty version (a backend that keeps none) or one that cannot be an
// entity tag (RFC 9110 8.8.3: no `"`, no control characters or spaces).
func setETag(w http.ResponseWriter, version string) {
	if version == "" || strings.ContainsFunc(version, func(r rune) bool { return r <= ' ' || r == '"' || r == 0x7f }) {
		return
	}
	w.Header().Set("ETag", `"`+version+`"`)
}

// ifMatch reads the If-Match header: the version the client last read, which
// the handler passes to the backend as the request's expected version, so a
// write from a stale tab is Aborted (409) instead of overwriting a newer
// change. "" means no precondition: the header is absent, or `*` (any
// current representation; the read or the write already answers 404 for a
// missing object). Only one strong entity tag is accepted, as the ETag
// header sends it; a weak tag, a list or a bare value is 422, because the
// backend compares one exact version.
func ifMatch(r *http.Request) (string, error) {
	values := r.Header.Values("If-Match")
	if len(values) == 0 {
		return "", nil
	}
	raw := strings.TrimSpace(values[0])
	if len(values) == 1 && raw == "*" {
		return "", nil
	}
	if len(values) == 1 && len(raw) > 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		if v := raw[1 : len(raw)-1]; !strings.ContainsFunc(v, func(r rune) bool { return r <= ' ' || r == '"' || r == 0x7f }) {
			return v, nil
		}
	}
	return "", Errorf(http.StatusUnprocessableEntity, `If-Match must be one entity tag as the ETag header sent it, for example "42", or *`)
}

// errorBody is the JSON shape of every error response.
type errorBody struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeJSON encodes v before it commits the status, so an encoding failure
// (a value JSON cannot carry, such as a NaN) is a 500 with an error body, not
// a 200 with a truncated one.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		status = http.StatusInternalServerError
		body, _ = json.Marshal(errorBody{Error: errorPayload{Code: strconv.Itoa(status), Message: "internal server error"}})
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(append(body, '\n'))
}

func writeData(w http.ResponseWriter, status int, v any) {
	writeJSON(w, status, envelope{Data: v})
}

func writeList(w http.ResponseWriter, status int, v any, meta ListMeta) {
	writeJSON(w, status, envelope{Data: v, Meta: &meta})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody{Error: errorPayload{Code: strconv.Itoa(status), Message: message}})
}
