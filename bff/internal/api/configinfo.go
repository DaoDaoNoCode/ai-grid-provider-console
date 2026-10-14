package api

import "net/http"

// ConsoleConfig is the deployment configuration the frontend needs at startup.
type ConsoleConfig struct {
	HubNamespace string `json:"hubNamespace"`
	GridEndpoint string `json:"gridEndpoint"`
	MapTileURL   string `json:"mapTileUrl"`
	BillingURL   string `json:"billingUrl"`
	Version      string `json:"version"`
}

// getConfig answers GET /api/v1/config.
func (a *App) getConfig(w http.ResponseWriter, _ *http.Request) {
	writeData(w, http.StatusOK, ConsoleConfig{
		HubNamespace: a.cfg.HubNamespace,
		GridEndpoint: a.cfg.GridEndpoint,
		MapTileURL:   a.cfg.MapTileURL,
		BillingURL:   a.cfg.BillingURL,
		Version:      Version,
	})
}
