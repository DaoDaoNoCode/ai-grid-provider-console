// Package api wires HTTP routes, middleware and handlers.
package api

import (
	"log/slog"
	"net/http"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/config"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/hub"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/identity"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/perses"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/relay"
)

// Version is set at build time with -ldflags "-X ...api.Version=<v>".
var Version = "dev"

// APIPrefix is the path prefix for JSON endpoints.
const APIPrefix = "/api/v1"

// App holds the dependencies shared by all handlers.
type App struct {
	cfg     config.Config
	logger  *slog.Logger
	backend *backend.Client
	// hub answers the provider-admin access review with the caller's token.
	hub     *hub.Client
	headers identity.Headers
	// perses relays the Monitoring page to the hub's Perses; nil when it is off.
	perses *perses.Relay
	// connect relays the browser's Connect calls to the backend's own RPCs; nil when it is off.
	connect *relay.Relay
}

// NewApp assembles the application.
func NewApp(cfg config.Config, logger *slog.Logger, client *backend.Client, hubClient *hub.Client) *App {
	return &App{
		cfg:     cfg,
		logger:  logger,
		backend: client,
		hub:     hubClient,
		headers: identity.Headers{
			User:        cfg.AuthUserHeader,
			Email:       cfg.AuthEmailHeader,
			Groups:      cfg.AuthGroupsHeader,
			Token:       cfg.AuthTokenHeader,
			TokenPrefix: cfg.AuthTokenPrefix,
		},
	}
}

// WithPerses turns on the Monitoring page's relay to the hub's Perses.
func (a *App) WithPerses(p *perses.Relay) *App {
	a.perses = p
	return a
}

// WithRelay turns on the relay of Connect calls (/ai_grid.v1.*) to the backend.
func (a *App) WithRelay(r *relay.Relay) *App {
	a.connect = r
	return a
}

// Handler returns the root HTTP handler.
func (a *App) Handler() http.Handler {
	api := http.NewServeMux()
	a.registerRoutes(api)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthcheck", a.healthcheck)
	root.HandleFunc("GET /readyz", a.readyz)
	root.Handle(APIPrefix+"/", a.requireIdentity(a.requireProviderAdmin(api)))
	// The Monitoring page's Perses calls: the same caller checks as the API, then the relay.
	root.Handle(perses.Prefix+"/", a.requireIdentity(a.requireProviderAdmin(http.HandlerFunc(a.relayPerses))))
	if a.cfg.StaticAssetsDir != "" {
		root.Handle("/", newSPAHandler(a.cfg.StaticAssetsDir))
	}

	// The backend's own RPCs over Connect: the same caller checks as the API, then the relay.
	// Routed before the mux, which has no pattern for a path prefix without a slash
	// (/ai_grid.v1.Clusters/List) and would redirect an unclean path instead of refusing it.
	connect := a.requireIdentity(a.requireProviderAdmin(http.HandlerFunc(a.relayConnect)))
	routes := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if relay.Handles(r.URL.Path) {
			connect.ServeHTTP(w, r)
			return
		}
		root.ServeHTTP(w, r)
	})

	return a.recoverPanic(a.logRequests(compress(routes)))
}

// relayPerses forwards an allowed Perses call with the caller's own token (perses.Relay decides
// which calls are allowed). Without a Perses server configured, Monitoring is off.
func (a *App) relayPerses(w http.ResponseWriter, r *http.Request) {
	if a.perses == nil {
		writeError(w, http.StatusNotFound, "monitoring is not configured on this console")
		return
	}
	id, _ := identity.FromContext(r.Context())
	a.perses.ServeHTTP(w, r.WithContext(perses.WithToken(r.Context(), id.Token())))
}

// relayConnect forwards a Connect call to the backend with the caller's identity (relay.Relay
// decides which calls pass).
func (a *App) relayConnect(w http.ResponseWriter, r *http.Request) {
	if a.connect == nil {
		relay.WriteError(w, http.StatusNotFound, "the Connect relay is not configured on this console")
		return
	}
	a.connect.ServeHTTP(w, r)
}
