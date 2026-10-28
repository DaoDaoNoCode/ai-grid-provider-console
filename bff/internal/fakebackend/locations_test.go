package fakebackend

import (
	"slices"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"

	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/api"
)

// gridMember is a ready, provisioned combined AI Grid member at location.
func gridMember(name, location string) *aigridv1.ManagedCluster {
	c := readyCluster(name)
	c.Labels[LabelAIGridEnabled] = "true"
	c.Labels[LabelAIGridProvisioned] = "true"
	c.Labels[LabelAIGridRole] = "combined"
	c.Labels[LabelLocation] = location
	return c
}

// TestListLocationsOnScenarioState: the backend's ListPlacementClusters over
// the clusters as scenario events leave them: the names of the provisioned,
// Available inference and combined members, sorted, two at one location
// included; a cluster the scenario takes offline drops out.
func TestListLocationsOnScenarioState(t *testing.T) {
	t.Parallel()
	notProvisioned := gridMember("berlin-1", "berlin")
	notProvisioned.Labels[LabelAIGridProvisioned] = "false"
	notMember := gridMember("oslo-1", "oslo")
	delete(notMember.Labels, LabelAIGridEnabled)
	ingress := gridMember("lyon-1", "lyon")
	ingress.Labels[LabelAIGridRole] = "ingress"
	inference := gridMember("rome-1", "")
	inference.Labels[LabelAIGridRole] = "inference"
	s := newServer(t, &Fixtures{
		Clusters: []*aigridv1.ManagedCluster{gridMember("paris-1", "paris"), gridMember("paris-2", "paris"), gridMember("madrid-1", "madrid"),
			notProvisioned, notMember, ingress, inference},
		Scenarios: []ScenarioEvent{{Cluster: "madrid-1", At: Duration{10 * time.Second}, Event: EventLeaseLost}},
	})
	start := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	now := start
	s.SetClock(func() time.Time { return now })
	list := func() []string {
		t.Helper()
		resp, err := s.ListLocations(authed(t.Context()), &aigridv1.ListLocationsRequest{})
		if err != nil {
			t.Fatal(err)
		}
		return resp.GetLocations()
	}
	if got := list(); !slices.Equal(got, []string{"madrid-1", "paris-1", "paris-2", "rome-1"}) {
		t.Fatalf("locations %v", got)
	}
	now = start.Add(10 * time.Second)
	if got := list(); !slices.Equal(got, []string{"paris-1", "paris-2", "rome-1"}) {
		t.Fatalf("after madrid lost its lease: %v", got)
	}
	if _, err := s.ListLocations(t.Context(), &aigridv1.ListLocationsRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("anonymous: %v", err)
	}
}

// TestListLocationsFromTheFixtures: under PR 12's fixtures only site-paris-1 is
// an Available, provisioned inference or combined member at start
// (site-madrid-1 is an ingress cluster, site-ashburn-1 isn't provisioned).
func TestListLocationsFromTheFixtures(t *testing.T) {
	t.Parallel()
	s := newRepoServer(t)
	resp, err := s.ListLocations(authed(t.Context()), &aigridv1.ListLocationsRequest{})
	if err != nil || !slices.Equal(resp.GetLocations(), []string{"site-paris-1"}) {
		t.Fatalf("locations %v %v", resp, err)
	}
}

// TestConsoleLabelsMatchTheBFF: the fake and the BFF name the same labels.
func TestConsoleLabelsMatchTheBFF(t *testing.T) {
	t.Parallel()
	for fake, bff := range map[string]string{
		LabelAIGridEnabled: api.LabelEnabled, LabelAIGridProvisioned: api.LabelProvisioned, LabelLocation: api.LabelLocation,
		LabelAIGridSite: api.LabelSite, LabelAIGridRegion: api.LabelRegion,
	} {
		if fake != bff {
			t.Errorf("fake label %q, BFF label %q", fake, bff)
		}
	}
}

// TestPlacementReportsLocations (P8): a placed model's status names the
// `location` labels of the clusters the placement decided on, unique and
// sorted; a decided cluster without one adds nothing, and a model without a
// placement has none.
func TestPlacementReportsLocations(t *testing.T) {
	t.Parallel()
	located := func(name, location string) *aigridv1.ManagedCluster {
		c := enrolled(name)
		if location != "" {
			c.Labels[LabelLocation] = location
		}
		return c
	}
	s, _ := modelServer(t, &Fixtures{Clusters: []*aigridv1.ManagedCluster{
		located("site-a", "paris"), located("site-b", "madrid"), located("site-c", "paris"), located("site-d", ""),
	}})
	placed := createModel(t, s, placedModel("placed", nil))
	if got := placed.GetStatus().GetPlacement().GetLocations(); !slices.Equal(got, []string{"madrid", "paris"}) {
		t.Errorf("placed model locations %v", got)
	}
	if got := getModel(t, s, "placed").GetStatus().GetPlacement().GetLocations(); !slices.Equal(got, []string{"madrid", "paris"}) {
		t.Errorf("read back %v", got)
	}
	if got := createModel(t, s, hubModel("hub")).GetStatus().GetPlacement(); got != nil {
		t.Errorf("hub model placement %v", got)
	}
}
