package api

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
)

func modelCondition(typ string, st aigridv1.ConditionStatus, reason, message string) *aigridv1.Condition {
	c := &aigridv1.Condition{Type: typ, Status: st, LastTransitionTime: timestamppb.New(time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC))}
	if reason != "" {
		c.Reason = proto.String(reason)
	}
	if message != "" {
		c.Message = proto.String(message)
	}
	return c
}

func seedModels() []*aigridv1.Model {
	return []*aigridv1.Model{
		{
			Name:     "tiny-llm",
			Metadata: &aigridv1.ObjectMeta{Namespace: "ai-grid-models", ResourceVersion: "7", Generation: 1, Labels: map[string]string{"ai-grid/family": "tiny"}, Annotations: map[string]string{AnnotationDisplayName: "Tiny LLM", AnnotationDescription: "CPU smoke test"}, CreationTimestamp: timestamppb.New(time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC))},
			Spec: &aigridv1.ModelSpec{
				Model: &aigridv1.ModelSource{Uri: "hf://example-org/tiny-llm", Name: "example-org/tiny-llm"}, Replicas: proto.Int32(1), BaseRefs: []string{"v3-6-0-kserve-config-llm-template-cpu"},
				Router: &aigridv1.Router{GatewayRefs: []*aigridv1.GatewayRef{{Name: "openshift-ai-inference", Namespace: "openshift-ingress"}}, ManagedRoute: true, Scheduler: true},
				Main:   &aigridv1.Container{Requests: map[string]string{"cpu": "4"}, Env: []*aigridv1.EnvVar{{Name: "VLLM_CPU_KVCACHE_SPACE", Value: "8"}}},
			},
			Status: &aigridv1.ModelStatus{
				Phase: aigridv1.ModelPhase_MODEL_PHASE_READY, Url: "https://openshift-ai-inference.apps.hub.example.com/ai-grid-models/tiny-llm", ObservedGeneration: 1,
				Addresses:      []*aigridv1.Address{{Name: "gateway-external", Url: "https://openshift-ai-inference.apps.hub.example.com/ai-grid-models/tiny-llm", Models: []string{"publishers/ai-grid-models/models/example-org/tiny-llm", "example-org/tiny-llm"}}},
				Conditions:     []*aigridv1.Condition{modelCondition("Ready", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "", ""), modelCondition("PresetsCombined", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "", "")},
				AppliedConfigs: []*aigridv1.AppliedConfig{{Name: "v3-6-0-kserve-config-llm-template", Namespace: "redhat-ods-applications", Source: "Preset"}},
			},
		},
		{
			Name:     "granite-8b-instruct",
			Metadata: &aigridv1.ObjectMeta{Namespace: "ai-grid-models", ResourceVersion: "9", Generation: 2, Labels: map[string]string{"ai-grid/family": "granite"}},
			Spec: &aigridv1.ModelSpec{
				Model: &aigridv1.ModelSource{Uri: "hf://example-org/granite-8b-instruct"}, Replicas: proto.Int32(1),
				Main:      &aigridv1.Container{Image: "quay.io/example/vllm-cuda:v0.11.0", Requests: map[string]string{"nvidia.com/gpu": "1"}, Limits: map[string]string{"nvidia.com/gpu": "1"}},
				Placement: &aigridv1.Placement{ClusterSets: []string{"global"}, LabelSelector: &aigridv1.LabelSelector{MatchLabels: map[string]string{"ai-grid/enabled": "true"}, MatchExpressions: []*aigridv1.LabelSelectorRequirement{{Key: "ai-grid/region", Operator: "In", Values: []string{"europe-west"}}}}, Tolerations: []*aigridv1.Toleration{{Key: "cluster.open-cluster-management.io/unreachable", Operator: "Exists", TolerationSeconds: proto.Int64(600)}}},
				Rollout:   &aigridv1.Rollout{Strategy: aigridv1.RolloutStrategy_ROLLOUT_STRATEGY_PROGRESSIVE, MaxConcurrency: "1", ProgressDeadline: "15m"},
			},
			Status: &aigridv1.ModelStatus{
				Phase: aigridv1.ModelPhase_MODEL_PHASE_PENDING, Reason: "Processing",
				Placement: &aigridv1.PlacementStatus{NumberOfSelectedClusters: 2, Decisions: []*aigridv1.ClusterDecision{{ClusterName: "site-paris-1"}, {ClusterName: "site-madrid-1"}}, Locations: []string{"madrid", "paris"},
					Conditions: []*aigridv1.Condition{modelCondition("PlacementSatisfied", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "AllDecisionsScheduled", "All cluster decisions scheduled")}},
				Rollout: &aigridv1.RolloutStatus{
					Summary:    &aigridv1.RolloutSummary{Total: 2, Applied: 2, Available: 1, Progressing: 1, Updated: 2}, // updated is never written by OCM; the BFF drops it
					Conditions: []*aigridv1.Condition{modelCondition("PlacementRolledOut", aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, "Progressing", ""), modelCondition("ManifestworkApplied", aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, "Processing", "")},
					Works: []*aigridv1.ManifestWorkStatus{
						{ClusterName: "site-madrid-1", WorkName: "model-granite-8b-instructx7k2p", Generation: 2}, // agent not reporting: empty status
						{ClusterName: "site-paris-1", WorkName: "model-granite-8b-instructm4q8z", Generation: 2, ObservedGeneration: 2,
							Conditions: []*aigridv1.Condition{modelCondition("Applied", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "AppliedManifestWorkComplete", "Apply manifest work complete"), modelCondition("Available", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "ResourcesAvailable", "All resources are available"), modelCondition("Progressing", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "ConditionRulesAggregated", "LLMInferenceService rolling out"), modelCondition("Degraded", aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, "ConditionRulesAggregated", "LLMInferenceService not ready")},
							Manifests:  []*aigridv1.ManifestStatus{{Resource: &aigridv1.ResourceIdentifier{Ordinal: 1, Kind: "LLMInferenceService"}, Feedback: []*aigridv1.FeedbackValue{{Name: "ready", Type: "String", Value: "False"}, {Name: "url", Type: "String", Value: "https://openshift-ai-inference.apps.site-paris-1.example.com/ai-grid-models/granite-8b-instruct"}}}}},
					},
				},
			},
		},
		{
			Name:     "other",
			Metadata: &aigridv1.ObjectMeta{Namespace: "team-b", ResourceVersion: "3", Generation: 1},
			Spec:     &aigridv1.ModelSpec{Model: &aigridv1.ModelSource{Uri: "s3://bucket/other"}, Scaling: &aigridv1.Scaling{MinReplicas: 1, MaxReplicas: 4, Keda: true}},
			Status:   &aigridv1.ModelStatus{Phase: aigridv1.ModelPhase_MODEL_PHASE_FAILED, Reason: "ConfigNotFound", Message: `LLMInferenceServiceConfig "x" not found in namespaces [team-b redhat-ods-applications]`},
		},
	}
}

func TestListModels(t *testing.T) {
	t.Parallel()
	fake := &backendtest.Fake{Models: seedModels()}
	app := newTestApp(t, testConfig(t), fake)
	var list []Model
	rec := serve(app, asUser(http.MethodGet, "/api/v1/models"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	meta := decodeList(t, rec, &list)
	if len(list) != 3 || list[0].Name != "granite-8b-instruct" || list[2].Namespace != "team-b" || total(meta) != 3 {
		t.Fatalf("list = %+v meta %+v", list, meta)
	}
	if fake.LastListModels.Filter != nil {
		t.Errorf("no query means no filter: %v", fake.LastListModels)
	}
	tiny := list[1]
	if tiny.DisplayName != "Tiny LLM" || tiny.Description != "CPU smoke test" || tiny.ModelURI != "hf://example-org/tiny-llm" || tiny.ModelName != "example-org/tiny-llm" || tiny.Replicas == nil || *tiny.Replicas != 1 || tiny.Phase != PhaseReady || tiny.URL == "" || len(tiny.Addresses) != 1 || len(tiny.Addresses[0].Models) != 2 || len(tiny.Conditions) != 2 || len(tiny.AppliedConfigs) != 1 || tiny.Env[0].Name != "VLLM_CPU_KVCACHE_SPACE" || tiny.Gateways[0].Name != "openshift-ai-inference" || tiny.Requests["cpu"] != "4" || tiny.Placement != nil || tiny.Rollout != nil || tiny.ResourceVersion != "7" || tiny.CreationTimestamp == nil {
		t.Errorf("tiny = %+v", tiny)
	}
	granite := list[0]
	if granite.ModelName != "granite-8b-instruct" || granite.Phase != PhasePending || granite.Reason != "Processing" || granite.Placement == nil || granite.Rollout == nil {
		t.Fatalf("granite = %+v", granite)
	}
	p := granite.Placement
	if !p.Satisfied || p.Reason != "AllDecisionsScheduled" || len(p.SelectedClusters) != 2 || !slices.Equal(p.Locations, []string{"madrid", "paris"}) || p.MatchLabels["ai-grid/enabled"] != "true" || p.MatchExpressions[0].Values[0] != "europe-west" || p.Tolerations[0].TolerationSeconds == nil || *p.Tolerations[0].TolerationSeconds != 600 || p.ClusterSets[0] != "global" {
		t.Errorf("placement = %+v", p)
	}
	r := granite.Rollout
	if r.Strategy != StrategyProgressive || r.MaxConcurrency != "1" || r.Summary.Total != 2 || r.Summary.Progressing != 1 || r.RolledOut || r.Applied || r.Reason != "Processing" || len(r.Works) != 2 {
		t.Errorf("rollout = %+v", r)
	}
	if strings.Contains(rec.Body.String(), `"updated"`) || strings.Contains(rec.Body.String(), `"desiredTotal"`) {
		t.Errorf("summary carries updated/desiredTotal, which OCM never writes: %s", rec.Body.String())
	}
	madrid, paris := r.Works[0], r.Works[1]
	if madrid.Applied != "" || madrid.Available != "" || madrid.Progressing != "" || madrid.Feedback.Ready != "" || madrid.Conditions == nil || madrid.ObservedGeneration != 0 {
		t.Errorf("madrid work = %+v", madrid)
	}
	if paris.Progressing != "True" || paris.Degraded != "False" || paris.Feedback.Ready != "False" || !strings.HasPrefix(paris.Feedback.URL, "https://openshift-ai-inference.apps.site-paris-1") || paris.WorkName != "model-granite-8b-instructm4q8z" || paris.ObservedGeneration != 2 {
		t.Errorf("paris work = %+v", paris)
	}
	other := list[2]
	if other.Replicas != nil || other.Scaling == nil || other.Scaling.MaxReplicas != 4 || other.Phase != PhaseFailed || other.Reason != "ConfigNotFound" || other.ModelName != "other" || other.BaseRefs == nil || other.Env == nil || other.Addresses == nil || other.Labels == nil {
		t.Errorf("other = %+v (collections are always present)", other)
	}

	// The client writes the CEL (the guarded label form, so a model without
	// the label is false instead of a `no such key` error); the BFF forwards it.
	const tinyFamily = `this.metadata.namespace == "ai-grid-models" && "ai-grid/family" in this.metadata.labels && this.metadata.labels["ai-grid/family"] == "tiny"`
	rec = serve(app, asUser(http.MethodGet, "/api/v1/models?offset=0&limit=5&filter="+url.QueryEscape(tinyFamily)))
	meta = decodeList(t, rec, &list)
	if fake.LastListModels.GetFilter() != tinyFamily || fake.LastListModels.GetLimit() != 5 {
		t.Errorf("query not mapped: %v", fake.LastListModels)
	}
	if len(list) != 1 || list[0].Name != "tiny-llm" || meta.Limit == nil || *meta.Limit != 5 || total(meta) != 1 {
		t.Errorf("filtered = %+v %+v", list, meta)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/models?filter="+url.QueryEscape(`this.status.phase == ai_grid.v1.ModelPhase.MODEL_PHASE_FAILED`)))
	if decodeList(t, rec, &list); rec.Code != http.StatusOK || len(list) != 1 || list[0].Name != "other" {
		t.Errorf("any CEL over the model = %d %+v", rec.Code, list)
	}
	// An unguarded index fails on a model without the key: the backend's
	// InvalidArgument, 422.
	rec = serve(app, asUser(http.MethodGet, "/api/v1/models?filter="+url.QueryEscape(`this.metadata.labels["ai-grid/family"] == "tiny"`)))
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(decodeError(t, rec).Error.Message, "no such key") {
		t.Errorf("unguarded index = %d %s", rec.Code, rec.Body.String())
	}
	for q, want := range map[string]string{
		"namespace=team-b":             `query parameter "namespace" is not supported; send a CEL filter in "filter"`,
		"label=ai-grid/family%3Dtiny":  `query parameter "label" is not supported; send a CEL filter in "filter"`,
		"label=nokey":                  `query parameter "label" is not supported; send a CEL filter in "filter"`,
		"offset=-1":                    `query parameter "offset" must be an integer between 0 and 2147483647`,
		"limit=x":                      `query parameter "limit" must be an integer between 0 and 2147483647`,
		"filter=true&namespace=team-b": `query parameter "namespace" is not supported; send a CEL filter in "filter"`,
	} {
		fake.Calls = nil
		if rec := serve(app, asUser(http.MethodGet, "/api/v1/models?"+q)); rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != want || len(fake.Calls) != 0 {
			t.Errorf("%s -> %d %s, calls %v; want 422 %q", q, rec.Code, rec.Body.String(), fake.Calls, want)
		}
	}
}

func TestModelFromTodaysShapes(t *testing.T) {
	t.Parallel()
	// A model without status, scaling or router renders with empty collections
	// and the name as model name, never nulls.
	m := toModel(&aigridv1.Model{Name: "bare", Metadata: &aigridv1.ObjectMeta{Namespace: "ns"}, Spec: &aigridv1.ModelSpec{Model: &aigridv1.ModelSource{Uri: "hf://x"}}})
	if m.ModelName != "bare" || m.Phase != "" || m.BaseRefs == nil || m.Requests == nil || m.Limits == nil || m.Env == nil || m.Gateways == nil || m.Addresses == nil || m.Conditions == nil || m.AppliedConfigs == nil || m.Labels == nil || m.Annotations == nil || m.Placement != nil {
		t.Errorf("bare = %+v", m)
	}
	// A placed model whose backend sent no rollout status still has a
	// placement with empty collections.
	m = toModel(&aigridv1.Model{Name: "p", Metadata: &aigridv1.ObjectMeta{Namespace: "ns"}, Spec: &aigridv1.ModelSpec{Placement: &aigridv1.Placement{}}})
	if m.Placement == nil || m.Placement.SelectedClusters == nil || m.Placement.Locations == nil || m.Placement.Conditions == nil || m.Rollout == nil || m.Rollout.Works == nil || m.Rollout.Strategy != StrategyAll {
		t.Errorf("placed = %+v", m)
	}
}

// TestModelWithoutSpec: a model the backend sends without a spec (as a
// subscription's referenced model can be) maps instead of panicking into a 500.
func TestModelWithoutSpec(t *testing.T) {
	t.Parallel()
	got := toModel(&aigridv1.Model{Name: "bare", Metadata: &aigridv1.ObjectMeta{Namespace: "ai-grid-models"}})
	if got.Name != "bare" || got.Replicas != nil {
		t.Fatalf("model %+v", got)
	}
}

// Each work's phase, reason and message, and a partially available model,
// pass through as the backend derived them (proposal P13).
func TestModelWorkPhasesPassThrough(t *testing.T) {
	t.Parallel()
	m := &aigridv1.Model{
		Name:     "m",
		Metadata: &aigridv1.ObjectMeta{Namespace: "ai-grid-models"},
		Spec:     &aigridv1.ModelSpec{Placement: &aigridv1.Placement{}},
		Status: &aigridv1.ModelStatus{
			Phase: aigridv1.ModelPhase_MODEL_PHASE_PARTIALLY_AVAILABLE, Reason: "PartiallyAvailable", Message: "1 of 2 clusters are serving the model.",
			Rollout: &aigridv1.RolloutStatus{Works: []*aigridv1.ManifestWorkStatus{
				{ClusterName: "site-a", Phase: aigridv1.ModelPhase_MODEL_PHASE_READY},
				{ClusterName: "site-b", Phase: aigridv1.ModelPhase_MODEL_PHASE_FAILED, Reason: "AppliedManifestWorkFailed", Message: "Failed to apply manifest work"},
			}},
		},
	}
	out := toModel(m)
	if out.Phase != PhasePartiallyAvailable || out.Message != "1 of 2 clusters are serving the model." {
		t.Errorf("model phase %q, message %q", out.Phase, out.Message)
	}
	a, b := out.Rollout.Works[0], out.Rollout.Works[1]
	if a.Phase != PhaseReady || a.Reason != "" || b.Phase != PhaseFailed || b.Reason != "AppliedManifestWorkFailed" || b.Message != "Failed to apply manifest work" {
		t.Errorf("works = %+v, %+v", a, b)
	}
}
