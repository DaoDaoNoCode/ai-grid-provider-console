package api

import "net/http"

// ConsoleConfig is the deployment configuration the frontend needs at startup.
type ConsoleConfig struct {
	GridEndpoint string `json:"gridEndpoint"`
	MapTileURL   string `json:"mapTileUrl"`
	BillingURL   string `json:"billingUrl"`
	Version      string `json:"version"`
	// FakeBackend tells the UI to show its fake-backend banner.
	FakeBackend bool `json:"fakeBackend"`
}

// getConfig answers GET /api/v1/config.
func (a *App) getConfig(w http.ResponseWriter, _ *http.Request) {
	writeData(w, http.StatusOK, ConsoleConfig{
		GridEndpoint: a.cfg.GridEndpoint,
		MapTileURL:   a.cfg.MapTileURL,
		BillingURL:   a.cfg.BillingURL,
		Version:      Version,
		FakeBackend:  a.cfg.FakeBackend,
	})
}
