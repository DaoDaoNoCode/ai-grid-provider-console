package fakebackend

import (
	"context"
	"maps"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Field-mask paths UpdateManagedCluster accepts (the mutable fields of the
// hub object a provider admin may patch). Anything else is InvalidArgument.
const (
	PathLabels           = "labels"
	PathAnnotations      = "annotations"
	PathHubAcceptsClient = "hub_accepts_client"
)

// The AI Grid annotations the backend owns the convention of: the map
// position of a site (mock/research/acm.md, the console's labels and
// annotations). UpdateManagedCluster checks them (checkCoordinates).
const (
	AnnotationLatitude  = "ai-grid/latitude"
	AnnotationLongitude = "ai-grid/longitude"
)

// checkCoordinates is the console's proposal for the backend, not
// API-server behaviour (the hub stores any annotation string): an
// `ai-grid/latitude` or `ai-grid/longitude` annotation that is present must
// be a finite decimal number within -90..90 or -180..180, so a bad value is
// refused on write instead of vanishing from the map on read (the BFF omits a
// coordinate it cannot parse). Console text, listed in mock/areas/clusters.md.
func checkCoordinates(annotations map[string]string) error {
	for _, c := range []struct {
		key   string
		limit float64
	}{{AnnotationLatitude, 90}, {AnnotationLongitude, 180}} {
		v, ok := annotations[c.key]
		if !ok {
			continue
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < -c.limit || f > c.limit {
			return status.Errorf(codes.InvalidArgument, "annotation %q must be a number between %v and %v, got %q", c.key, -c.limit, c.limit, v)
		}
	}
	return nil
}

// notFound is the NotFound message shape from the conventions' error table
// (`object with identifier '<x>' not found`).
func notFound(name string) error {
	return status.Errorf(codes.NotFound, "object with identifier '%s' not found", name)
}

// ListManagedClusters implements ManagedClusters. Like a hub list, the result
// is sorted by name; `offset` and `limit` page it (omitted limit means all,
// zero means count only, negative is InvalidArgument). `filter` and `order`
// are drafted but not implemented here, so a non-empty value is
// InvalidArgument rather than silently ignored.
func (s *Server) ListManagedClusters(ctx context.Context, req *aigridv1.ListManagedClustersRequest) (*aigridv1.ListManagedClustersResponse, error) {
	if _, err := s.begin(ctx); err != nil {
		return nil, err
	}
	if req.GetFilter() != "" {
		return nil, status.Error(codes.InvalidArgument, "filter is not supported by this server yet")
	}
	if req.GetOrder() != "" {
		return nil, status.Error(codes.InvalidArgument, "order is not supported by this server yet")
	}
	if req.GetOffset() < 0 {
		return nil, status.Errorf(codes.InvalidArgument, "offset must not be negative, got %d", req.GetOffset())
	}
	if req.Limit != nil && req.GetLimit() < 0 {
		return nil, status.Errorf(codes.InvalidArgument, "limit must not be negative, got %d", req.GetLimit())
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.advance()
	all := make([]*aigridv1.ManagedCluster, 0, len(s.clusters))
	for _, c := range s.clusters {
		all = append(all, withDerivedState(c))
	}
	sort.Slice(all, func(i, j int) bool { return all[i].GetName() < all[j].GetName() })
	total := len(all)
	offset := min(int(req.GetOffset()), total)
	page := all[offset:]
	if req.Limit != nil && int(req.GetLimit()) < len(page) {
		page = page[:req.GetLimit()]
	}
	return &aigridv1.ListManagedClustersResponse{Clusters: page, Size: int32(len(page)), Total: int32(total)}, nil
}

// GetManagedCluster implements ManagedClusters.
func (s *Server) GetManagedCluster(ctx context.Context, req *aigridv1.GetManagedClusterRequest) (*aigridv1.GetManagedClusterResponse, error) {
	if _, err := s.begin(ctx); err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.advance()
	c, ok := s.clusters[req.GetName()]
	if !ok {
		return nil, notFound(req.GetName())
	}
	return &aigridv1.GetManagedClusterResponse{Object: withDerivedState(c)}, nil
}

// UpdateManagedCluster implements ManagedClusters with the semantics of
// mock/research/backend-conventions.md section 5.3: the mask names whole
// fields of `object` (a map path replaces the map), `lock` compares
// `resource_version` and fails with Aborted, and every write bumps the
// version. The hub's webhook and controllers then react as reconcileMetadata
// describes (default clusterset, `name`, created-via, add-on and autodetect
// labels come back). Flipping `hub_accepts_client` makes the registration
// controller rewrite `HubAcceptedManagedCluster` as the hub would.
//
// An update that changes nothing is not written: when the object after the
// update, with the hub-owned labels put back, has the stored labels,
// annotations and `hub_accepts_client`, the stored cluster comes back with its
// `resource_version` and `generation` unchanged, as the Kubernetes API server
// answers an unchanged update (k8s.io/apiserver v0.35.8
// pkg/storage/etcd3/store.go:553-577, GuaranteedUpdate skips the write when the
// new object encodes to the stored bytes). The `lock` precondition is checked
// before, as the API server checks the resource version before it gets there
// (pkg/registry/generic/registry/store.go:735-736), and so is the console's
// coordinate check (checkCoordinates), so a stale or invalid no-op still fails.
func (s *Server) UpdateManagedCluster(ctx context.Context, req *aigridv1.UpdateManagedClusterRequest) (*aigridv1.UpdateManagedClusterResponse, error) {
	token, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	obj := req.GetObject()
	if obj.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "object.name is required")
	}
	if err := s.authorizePatch(ctx, token, obj.GetName()); err != nil {
		return nil, err
	}
	paths := req.GetUpdateMask().GetPaths()
	if len(paths) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "update_mask must name at least one of %s", strings.Join([]string{PathLabels, PathAnnotations, PathHubAcceptsClient}, ", "))
	}
	for _, p := range paths {
		switch p {
		case PathLabels, PathAnnotations, PathHubAcceptsClient:
		default:
			return nil, status.Errorf(codes.InvalidArgument, "update_mask path %q is not supported; supported paths: %s", p, strings.Join([]string{PathLabels, PathAnnotations, PathHubAcceptsClient}, ", "))
		}
	}
	if slices.Contains(paths, PathAnnotations) {
		if err := checkCoordinates(obj.GetAnnotations()); err != nil {
			return nil, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	scenarioNow := s.advance()
	c, ok := s.clusters[obj.GetName()]
	if !ok {
		return nil, notFound(obj.GetName())
	}
	if req.GetLock() && obj.GetResourceVersion() != c.GetResourceVersion() {
		return nil, status.Errorf(codes.Aborted, "object with identifier '%s' has resource version %s, the request carries %q; fetch it again and retry", obj.GetName(), c.GetResourceVersion(), obj.GetResourceVersion())
	}
	// The no-op check runs the update on a copy first, the webhook's and
	// controllers' follow-up included, and compares what a write could change.
	probe := cloneCluster(c)
	for _, p := range paths {
		switch p {
		case PathLabels:
			probe.Labels = copyMap(obj.GetLabels())
		case PathAnnotations:
			probe.Annotations = copyMap(obj.GetAnnotations())
		case PathHubAcceptsClient:
			probe.HubAcceptsClient = obj.GetHubAcceptsClient()
		}
	}
	reconcileMetadata(probe, c)
	if maps.Equal(probe.GetLabels(), c.GetLabels()) && maps.Equal(probe.GetAnnotations(), c.GetAnnotations()) && probe.GetHubAcceptsClient() == c.GetHubAcceptsClient() {
		s.logger.Debug("cluster update changes nothing", "name", c.GetName(), "paths", paths, "resourceVersion", c.GetResourceVersion())
		return &aigridv1.UpdateManagedClusterResponse{Object: withDerivedState(c)}, nil
	}
	now := s.clock()
	before := cloneCluster(c)
	for _, p := range paths {
		switch p {
		case PathLabels:
			c.Labels = copyMap(obj.GetLabels())
		case PathAnnotations:
			c.Annotations = copyMap(obj.GetAnnotations())
		case PathHubAcceptsClient:
			if c.GetHubAcceptsClient() == obj.GetHubAcceptsClient() {
				continue
			}
			c.HubAcceptsClient = obj.GetHubAcceptsClient()
			c.Generation++ // a spec change
			// The registration controller
			// (ocm:pkg/registration/hub/managedcluster/controller.go): accepting
			// writes True (L264-270), or False/`Error` when applying the
			// cluster's RBAC fails (L272-277, not simulated); denying writes False only for a
			// cluster that was accepted, and does nothing for one that never
			// was (L164-167).
			switch {
			case c.HubAcceptsClient:
				setCondition(c, now, CondHubAccepted, aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, ReasonHubAccepted, MessageHubAccepted)
			case isTrue(c, CondHubAccepted):
				setCondition(c, now, CondHubAccepted, aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, ReasonHubDenied, MessageHubDenied)
			}
		}
	}
	reconcileMetadata(c, before)
	s.bumpResourceVersion(c)
	s.reconcileModels(scenarioNow) // Placements watch cluster labels and taints
	s.logger.Debug("cluster updated", "name", c.GetName(), "paths", paths, "resourceVersion", c.GetResourceVersion())
	return &aigridv1.UpdateManagedClusterResponse{Object: withDerivedState(c)}, nil
}

// copyMap returns an owned, non-nil copy so the request cannot alias the
// store. An empty map is kept as empty (whole-map replacement semantics).
func copyMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return maps.Clone(m)
}
