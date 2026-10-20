// Package api wires HTTP routes, middleware and handlers.
package api

import (
	"log/slog"
	"net/http"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/config"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/hub"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/identity"
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

// Handler returns the root HTTP handler.
func (a *App) Handler() http.Handler {
	api := http.NewServeMux()
	a.registerRoutes(api)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthcheck", a.healthcheck)
	root.HandleFunc("GET /readyz", a.readyz)
	root.Handle(APIPrefix+"/", a.requireIdentity(a.requireProviderAdmin(api)))
	if a.cfg.StaticAssetsDir != "" {
		root.Handle("/", newSPAHandler(a.cfg.StaticAssetsDir))
	}

	return a.recoverPanic(a.logRequests(root))
}
