package api

import "net/http"

// registerRoutes attaches every authenticated endpoint. Keep this list in sync
// with docs/plan/bff-api.md.
func (a *App) registerRoutes(mux *http.ServeMux) {
	// Unknown API paths get a JSON 404 instead of the SPA fallback.
	mux.HandleFunc(APIPrefix+"/", a.notFound)
}

func (a *App) notFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "the requested resource could not be found")
}
