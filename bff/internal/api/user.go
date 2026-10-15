package api

import (
	"net/http"
	"slices"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/identity"
)

// User is the signed-in caller as the UI shows it.
type User struct {
	Username string   `json:"username"`
	Email    string   `json:"email,omitempty"`
	Groups   []string `json:"groups"`
	// IsProviderAdmin tells the UI whether to offer provider-admin actions.
	// It is a hint derived from the proxy's group header; the backend decides.
	IsProviderAdmin bool `json:"isProviderAdmin"`
}

// getUser answers GET /api/v1/user from the proxy headers. No backend call is
// needed: the proxy already authenticated the caller.
func (a *App) getUser(w http.ResponseWriter, r *http.Request) {
	id, _ := identity.FromContext(r.Context())
	groups := id.Groups
	if groups == nil {
		groups = []string{}
	}
	writeData(w, http.StatusOK, User{
		Username:        id.Username,
		Email:           id.Email,
		Groups:          groups,
		IsProviderAdmin: a.isProviderAdmin(id),
	})
}

func (a *App) isProviderAdmin(id identity.Identity) bool {
	if len(a.cfg.ProviderAdminGroups) == 0 {
		return true
	}
	return slices.ContainsFunc(id.Groups, func(g string) bool { return slices.Contains(a.cfg.ProviderAdminGroups, g) })
}
