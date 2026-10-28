// Ported from krisv/ai-grid-cloud-provider-poc shared/grid-clusters.mjs at 62319b8.

package fakebackend

import (
	"context"
	"slices"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Labels the console reads and writes on a ManagedCluster, the conventions of
// the PoC (shared/grid-clusters.mjs at 62319b8); the BFF names the same ones
// (api.LabelEnabled and its neighbours).
const (
	LabelAIGridEnabled     = "ai-grid/enabled"
	LabelAIGridProvisioned = "ai-grid/provisioned"
	LabelLocation          = "location"
	LabelAIGridSite        = "ai-grid/site"
	LabelAIGridRegion      = "ai-grid/region"
	LabelAIGridRole        = "ai-grid/role"
)

// ListLocations implements Models (proposal P7) as the backend's
// Models/ListPlacementClusters answers (ai-grid-provider-backend
// proto/ai_grid/v1/models_service.proto at 71bb8cc): the names of the AI Grid
// members with role inference or combined that are provisioned and Available,
// sorted, over the clusters as scenario events leave them. These are the values
// a placement's `name In [...]` takes; a location is the value of the
// `location` label, which a model's status reports (P8). The fake's
// `ai-grid/provisioned` label stands in for the backend's ready-Policy
// compliance.
func (s *Server) ListLocations(ctx context.Context, _ *aigridv1.ListLocationsRequest) (*aigridv1.ListLocationsResponse, error) {
	if _, err := s.begin(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.advance()
	out := []string{}
	for name, c := range s.clusters {
		labels := c.GetLabels()
		if labels[LabelAIGridEnabled] != "true" || labels[LabelAIGridProvisioned] != "true" {
			continue
		}
		if role := labels[LabelAIGridRole]; role != "inference" && role != "combined" {
			continue
		}
		if state, _ := deriveState(c); state != aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_AVAILABLE {
			continue
		}
		out = append(out, name)
	}
	slices.Sort(out)
	return &aigridv1.ListLocationsResponse{Locations: out}, nil
}
