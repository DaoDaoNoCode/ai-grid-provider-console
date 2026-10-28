package fakebackend

import (
	"maps"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// The backend, not the BFF, decides that an update changes nothing: the BFF
// sends every field the client sent, and an unchanged object comes back with
// its stored resource_version, as the API server answers an unchanged update.

func TestUnchangedClusterUpdateIsNotWritten(t *testing.T) {
	t.Parallel()
	// A cluster as the hub keeps it: with the default clusterset label the
	// webhook would otherwise add on the first write.
	c := readyCluster("a")
	c.Labels[LabelClusterSet] = ClusterSetDefault
	s := newServer(t, &Fixtures{Clusters: []*aigridv1.ManagedCluster{c}})
	ctx := authed(t.Context())
	get := func() *aigridv1.ManagedCluster {
		t.Helper()
		resp, err := s.GetManagedCluster(ctx, &aigridv1.GetManagedClusterRequest{Name: "a"})
		if err != nil {
			t.Fatal(err)
		}
		return resp.GetObject()
	}
	update := func(obj *aigridv1.ManagedCluster, paths ...string) (*aigridv1.ManagedCluster, error) {
		resp, err := s.UpdateManagedCluster(ctx, &aigridv1.UpdateManagedClusterRequest{Object: obj, UpdateMask: &fieldmaskpb.FieldMask{Paths: paths}, Lock: true})
		return resp.GetObject(), err
	}
	stored := get()
	rv, gen := stored.GetResourceVersion(), stored.GetGeneration()

	withoutName := maps.Clone(stored.GetLabels())
	delete(withoutName, LabelName) // the webhook puts `name` back, so leaving it out changes nothing
	for _, tc := range []struct {
		name  string
		obj   *aigridv1.ManagedCluster
		paths []string
	}{
		{"the stored maps", &aigridv1.ManagedCluster{Labels: stored.GetLabels(), Annotations: stored.GetAnnotations()}, []string{PathLabels, PathAnnotations}},
		{"without a hub-owned label", &aigridv1.ManagedCluster{Labels: withoutName}, []string{PathLabels}},
	} {
		tc.obj.Name, tc.obj.ResourceVersion = "a", rv
		got, err := update(tc.obj, tc.paths...)
		if err != nil || got.GetResourceVersion() != rv || got.GetGeneration() != gen {
			t.Errorf("%s: %v, rv %s gen %d; want the stored %s/%d", tc.name, err, got.GetResourceVersion(), got.GetGeneration(), rv, gen)
		}
	}
	if again := get(); again.GetResourceVersion() != rv || !maps.Equal(again.GetLabels(), stored.GetLabels()) {
		t.Errorf("a no-op must leave the store alone: %v", again)
	}
	// The precondition runs first: a stale no-op is still Aborted.
	_, err := update(&aigridv1.ManagedCluster{Name: "a", ResourceVersion: "1", Labels: stored.GetLabels()}, PathLabels)
	mustCode(t, err, codes.Aborted, "")
	// A real change writes and bumps the version.
	labels := maps.Clone(stored.GetLabels())
	labels["ai-grid/enabled"] = "true"
	got, err := update(&aigridv1.ManagedCluster{Name: "a", ResourceVersion: rv, Labels: labels}, PathLabels)
	if err != nil || got.GetResourceVersion() == rv || got.GetLabels()["ai-grid/enabled"] != "true" {
		t.Errorf("a change = %v, %v", got, err)
	}
}

// The coordinate annotations are the backend's convention (a console
// proposal, not API-server behaviour): present means a number in range.
func TestClusterCoordinatesAreChecked(t *testing.T) {
	t.Parallel()
	s := newServer(t, &Fixtures{Clusters: []*aigridv1.ManagedCluster{readyCluster("a")}})
	ctx := authed(t.Context())
	update := func(annotations map[string]string) (*aigridv1.ManagedCluster, error) {
		resp, err := s.UpdateManagedCluster(ctx, &aigridv1.UpdateManagedClusterRequest{Object: &aigridv1.ManagedCluster{Name: "a", Annotations: annotations}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{PathAnnotations}}})
		return resp.GetObject(), err
	}
	for annotations, want := range map[[2]string]string{
		{AnnotationLatitude, "91"}:      `annotation "ai-grid/latitude" must be a number between -90 and 90, got "91"`,
		{AnnotationLatitude, "north"}:   `annotation "ai-grid/latitude" must be a number between -90 and 90, got "north"`,
		{AnnotationLatitude, "NaN"}:     `annotation "ai-grid/latitude" must be a number between -90 and 90, got "NaN"`,
		{AnnotationLongitude, "-180.5"}: `annotation "ai-grid/longitude" must be a number between -180 and 180, got "-180.5"`,
		{AnnotationLongitude, "+Inf"}:   `annotation "ai-grid/longitude" must be a number between -180 and 180, got "+Inf"`,
	} {
		_, err := update(map[string]string{annotations[0]: annotations[1]})
		mustCode(t, err, codes.InvalidArgument, want)
	}
	got, err := update(map[string]string{AnnotationLatitude: "-90", AnnotationLongitude: "2.3522", "ai-grid/site-name": "Paris DC1"})
	if err != nil || got.GetAnnotations()[AnnotationLatitude] != "-90" {
		t.Errorf("valid coordinates = %v, %v", got, err)
	}
	// What the read side shows fine passes: it trims the value and shows an
	// empty one as no coordinate, so a client sending the map it loaded back
	// is not refused for a key it never touched.
	for _, v := range []string{" 2.3522", "2.3522\n", ""} {
		if _, err := update(map[string]string{AnnotationLongitude: v}); err != nil {
			t.Errorf("longitude %q = %v", v, err)
		}
	}
	// Labels alone are not checked against annotations the fixtures carry.
	if _, err := s.UpdateManagedCluster(ctx, &aigridv1.UpdateManagedClusterRequest{Object: &aigridv1.ManagedCluster{Name: "a", Labels: labelsWith(readyCluster("a"), "ai-grid/x", "y")}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{PathLabels}}}); err != nil {
		t.Errorf("labels update = %v", err)
	}
}

func TestUnchangedModelUpdateIsNotWritten(t *testing.T) {
	t.Parallel()
	s, advance := modelServer(t, &Fixtures{Clusters: []*aigridv1.ManagedCluster{enrolled("site-a")}})
	ctx := authed(t.Context())
	createModel(t, s, hubModel("hub"))
	advance(time.Minute)
	stored := getModel(t, s, "hub")
	rv, gen := stored.GetMetadata().GetResourceVersion(), stored.GetMetadata().GetGeneration()
	same := &aigridv1.Model{Name: "hub", Metadata: &aigridv1.ObjectMeta{Namespace: testNS, ResourceVersion: rv, Labels: stored.GetMetadata().GetLabels(), Annotations: stored.GetMetadata().GetAnnotations()},
		Spec: &aigridv1.ModelSpec{Replicas: proto.Int32(stored.GetSpec().GetReplicas()), Main: &aigridv1.Container{Image: stored.GetSpec().GetMain().GetImage(), Env: stored.GetSpec().GetMain().GetEnv()}}}
	resp, err := s.UpdateModel(ctx, &aigridv1.UpdateModelRequest{Object: same, Lock: true, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{PathSpecReplicas, PathSpecMainImage, PathSpecMainEnv, PathSpecPlacement, PathSpecRollout, PathMetadataLabels, PathMetadataAnnotation}}})
	if err != nil || resp.GetObject().GetMetadata().GetResourceVersion() != rv || resp.GetObject().GetMetadata().GetGeneration() != gen {
		t.Fatalf("unchanged update = %v, %v; want rv %s gen %d", resp.GetObject().GetMetadata(), err, rv, gen)
	}
	wantPhase(t, resp.GetObject(), aigridv1.ModelPhase_MODEL_PHASE_READY, "")
	// A stale no-op is still Aborted, an invalid one still InvalidArgument.
	same.Metadata.ResourceVersion = "1"
	_, err = s.UpdateModel(ctx, &aigridv1.UpdateModelRequest{Object: same, Lock: true, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{PathSpecReplicas}}})
	mustCode(t, err, codes.Aborted, "")
	// One changed annotation is a write.
	same.Metadata.ResourceVersion = rv
	same.Metadata.Annotations = map[string]string{AnnotationDisplayName: "Renamed"}
	resp, err = s.UpdateModel(ctx, &aigridv1.UpdateModelRequest{Object: same, Lock: true, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{PathMetadataAnnotation}}})
	if err != nil || resp.GetObject().GetMetadata().GetResourceVersion() == rv || resp.GetObject().GetMetadata().GetGeneration() != gen {
		t.Errorf("annotation change = %v, %v", resp.GetObject().GetMetadata(), err)
	}
}

func TestUnchangedTenantUpdateIsNotPut(t *testing.T) {
	t.Parallel()
	s := tenantServer(t)
	ctx := authed(t.Context())
	update := func(obj *aigridv1.Tenant, paths ...string) (*aigridv1.Tenant, error) {
		resp, err := s.UpdateTenant(ctx, &aigridv1.UpdateTenantRequest{Object: obj, UpdateMask: &fieldmaskpb.FieldMask{Paths: paths}})
		return resp.GetObject(), err
	}
	// The stored values, the stored alias, and the alias path alone: no PUT,
	// the version stays.
	for _, tc := range []struct {
		obj   *aigridv1.Tenant
		paths []string
	}{
		{&aigridv1.Tenant{Id: idGlobex, Name: "globex-research", Enabled: proto.Bool(true), Domains: []string{"globex.example.com"}}, []string{PathName, PathEnabled, PathDomains}},
		{&aigridv1.Tenant{Id: idGlobex, Alias: "globex"}, []string{PathAlias}},
		{&aigridv1.Tenant{Id: idGlobex}, []string{PathAlias}}, // blank: the stored alias is kept
		{&aigridv1.Tenant{Id: idGlobex, ResourceVersion: "1", Description: ""}, []string{PathDescription}},
	} {
		got, err := update(tc.obj, tc.paths...)
		if err != nil || got.GetResourceVersion() != "1" || got.GetAlias() != "globex" {
			t.Errorf("%v %v = %v, %v; want version 1", tc.obj, tc.paths, got, err)
		}
	}
	// A different alias is Keycloak's answer, with or without other paths.
	_, err := update(&aigridv1.Tenant{Id: idGlobex, Alias: "globex-2"}, PathAlias)
	mustCode(t, err, codes.InvalidArgument, MsgAliasImmutable)
	_, err = update(&aigridv1.Tenant{Id: idGlobex, Alias: "globex-2", Description: "x"}, PathAlias, PathDescription)
	mustCode(t, err, codes.InvalidArgument, MsgAliasImmutable)
	// The precondition still runs on a no-op.
	_, err = update(&aigridv1.Tenant{Id: idGlobex, ResourceVersion: "7", Alias: "globex"}, PathAlias)
	mustCode(t, err, codes.Aborted, "")
	// A real change is PUT and bumps the version.
	got, err := update(&aigridv1.Tenant{Id: idGlobex, Alias: "globex", Description: "Globex"}, PathAlias, PathDescription)
	if err != nil || got.GetResourceVersion() != "2" || got.GetDescription() != "Globex" {
		t.Errorf("a change = %v, %v", got, err)
	}
}
