package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// envelope wraps every successful JSON response.
type envelope struct {
	Data any `json:"data"`
}

// errorBody is the JSON shape of every error response.
type errorBody struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeData(w http.ResponseWriter, status int, v any) {
	writeJSON(w, status, envelope{Data: v})
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody{Error: errorPayload{Code: strconv.Itoa(status), Message: message}})
}
