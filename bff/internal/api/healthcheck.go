package api

import "net/http"

type healthStatus struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// healthcheck needs no identity; the kubelet calls it.
func (a *App) healthcheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, healthStatus{Status: "ok", Version: Version})
}
