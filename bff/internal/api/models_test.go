package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
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
				Router: &aigridv1.Router{GatewayRefs: []*aigridv1.GatewayRef{{Name: DefaultGatewayName, Namespace: DefaultGatewayNamespace}}, ManagedRoute: true, Scheduler: true},
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
				Placement: &aigridv1.PlacementStatus{NumberOfSelectedClusters: 2, Decisions: []*aigridv1.ClusterDecision{{ClusterName: "site-paris-1"}, {ClusterName: "site-madrid-1"}},
					Conditions: []*aigridv1.Condition{modelCondition("PlacementSatisfied", aigridv1.ConditionStatus_CONDITION_STATUS_TRUE, "AllDecisionsScheduled", "All cluster decisions scheduled")}},
				Rollout: &aigridv1.RolloutStatus{
					Summary:    &aigridv1.RolloutSummary{Total: 2, Applied: 2, Available: 1, Progressing: 1, Updated: 2},
					Conditions: []*aigridv1.Condition{modelCondition("PlacementRolledOut", aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, "Progressing", ""), modelCondition("ManifestworkApplied", aigridv1.ConditionStatus_CONDITION_STATUS_FALSE, "Processing", "")},
					Works: []*aigridv1.ManifestWorkStatus{
						{ClusterName: "site-madrid-1", WorkName: "model-granite-8b-instruct-x7k2p", Generation: 2}, // agent not reporting: empty status
						{ClusterName: "site-paris-1", WorkName: "model-granite-8b-instruct-m4q8z", Generation: 2, ObservedGeneration: 2,
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
	fake := &backendtest.Fake{Models: seedModels()}
	app := newTestApp(t, testConfig(t), fake)
	var list []Model
	rec := serve(app, asUser(http.MethodGet, "/api/v1/models"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	meta := decodeList(t, rec, &list)
	if len(list) != 3 || list[0].Name != "granite-8b-instruct" || list[2].Namespace != "team-b" || meta.Total != 3 {
		t.Fatalf("list = %+v meta %+v", list, meta)
	}
	if fake.LastListModels.Filter != nil {
		t.Errorf("no query means no filter: %v", fake.LastListModels)
	}
	tiny := list[1]
	if tiny.DisplayName != "Tiny LLM" || tiny.Description != "CPU smoke test" || tiny.ModelURI != "hf://example-org/tiny-llm" || tiny.ModelName != "example-org/tiny-llm" || tiny.Replicas == nil || *tiny.Replicas != 1 || tiny.Phase != PhaseReady || tiny.URL == "" || len(tiny.Addresses) != 1 || len(tiny.Addresses[0].Models) != 2 || len(tiny.Conditions) != 2 || len(tiny.AppliedConfigs) != 1 || tiny.Env[0].Name != "VLLM_CPU_KVCACHE_SPACE" || tiny.Gateways[0].Name != DefaultGatewayName || tiny.Requests["cpu"] != "4" || tiny.Placement != nil || tiny.Rollout != nil || tiny.ResourceVersion != "7" || tiny.CreationTimestamp == nil {
		t.Errorf("tiny = %+v", tiny)
	}
	granite := list[0]
	if granite.ModelName != "granite-8b-instruct" || granite.Phase != PhasePending || granite.Reason != "Processing" || granite.Placement == nil || granite.Rollout == nil {
		t.Fatalf("granite = %+v", granite)
	}
	p := granite.Placement
	if !p.Satisfied || p.Reason != "AllDecisionsScheduled" || len(p.SelectedClusters) != 2 || p.MatchLabels["ai-grid/enabled"] != "true" || p.MatchExpressions[0].Values[0] != "europe-west" || p.Tolerations[0].TolerationSeconds == nil || *p.Tolerations[0].TolerationSeconds != 600 || p.ClusterSets[0] != "global" {
		t.Errorf("placement = %+v", p)
	}
	r := granite.Rollout
	if r.Strategy != StrategyProgressive || r.MaxConcurrency != "1" || r.Summary.Total != 2 || r.Summary.Progressing != 1 || r.RolledOut || r.Applied || r.Reason != "Processing" || len(r.Works) != 2 {
		t.Errorf("rollout = %+v", r)
	}
	madrid, paris := r.Works[0], r.Works[1]
	if madrid.Applied != "" || madrid.Available != "" || madrid.Progressing != "" || madrid.Feedback.Ready != "" || madrid.Conditions == nil || madrid.ObservedGeneration != 0 {
		t.Errorf("madrid work = %+v", madrid)
	}
	if paris.Progressing != "True" || paris.Degraded != "False" || paris.Feedback.Ready != "False" || !strings.HasPrefix(paris.Feedback.URL, "https://openshift-ai-inference.apps.site-paris-1") || paris.WorkName != "model-granite-8b-instruct-m4q8z" || paris.ObservedGeneration != 2 {
		t.Errorf("paris work = %+v", paris)
	}
	other := list[2]
	if other.Replicas != nil || other.Scaling == nil || other.Scaling.MaxReplicas != 4 || other.Phase != PhaseFailed || other.Reason != "ConfigNotFound" || other.ModelName != "other" || other.BaseRefs == nil || other.Env == nil || other.Addresses == nil || other.Labels == nil {
		t.Errorf("other = %+v (collections are always present)", other)
	}

	rec = serve(app, asUser(http.MethodGet, "/api/v1/models?namespace=ai-grid-models&label=ai-grid/family%3Dtiny&offset=0&limit=5"))
	meta = decodeList(t, rec, &list)
	if fake.LastListModels.GetFilter() != `this.metadata.namespace == "ai-grid-models" && this.metadata.labels["ai-grid/family"] == "tiny"` || fake.LastListModels.GetLimit() != 5 {
		t.Errorf("query not mapped: %v", fake.LastListModels)
	}
	if len(list) != 1 || list[0].Name != "tiny-llm" || meta.Limit == nil || *meta.Limit != 5 {
		t.Errorf("filtered = %+v %+v", list, meta)
	}
	for _, q := range []string{"label=nokey", "offset=-1", "limit=x"} {
		if rec := serve(app, asUser(http.MethodGet, "/api/v1/models?"+q)); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s -> %d, want 422", q, rec.Code)
		}
	}
}

func TestGetModel(t *testing.T) {
	app := newTestApp(t, testConfig(t), &backendtest.Fake{Models: seedModels()})
	var m Model
	rec := serve(app, asUser(http.MethodGet, "/api/v1/models/team-b/other"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &m)
	if m.Name != "other" || m.Namespace != "team-b" || m.Message == "" {
		t.Errorf("model = %+v", m)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/models/team-b/nope"))
	if rec.Code != http.StatusNotFound || decodeError(t, rec).Error.Message != "object with identifier 'team-b/nope' not found" {
		t.Errorf("not found = %d %s", rec.Code, rec.Body.String())
	}
}

func TestCreateModel(t *testing.T) {
	fake := &backendtest.Fake{Models: seedModels()}
	app := newTestApp(t, testConfig(t), fake)
	body := `{"name": "mistral-7b", "namespace": "ai-grid-models", "displayName": "Mistral 7B", "description": "EU sites", "modelUri": "oci://registry.example.com/models/mistral:v0.3", "modelName": "example-org/mistral-7b",
	  "runtimeImage": "quay.io/example/vllm-cuda:v0.11.0", "replicas": 2, "baseRefs": ["v3-6-0-kserve-config-llm-template"], "cpu": "8", "memory": "32Gi", "gpuCount": 1, "env": [{"name": "VLLM_ADDITIONAL_ARGS", "value": "--max-model-len 8192"}],
	  "placement": {"matchLabels": {"ai-grid/enabled": "true"}, "matchExpressions": [{"key": "location", "operator": "In", "values": ["paris", "madrid"]}], "tolerations": [{"key": "cluster.open-cluster-management.io/unreachable", "operator": "Exists", "tolerationSeconds": 600}], "numberOfClusters": 2},
	  "rollout": {"strategy": "Progressive", "maxConcurrency": "1", "progressDeadline": "15m"}, "labels": {"ai-grid/family": "mistral"}}`
	rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/models", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/api/v1/models/ai-grid-models/mistral-7b" {
		t.Errorf("Location = %q", loc)
	}
	var m Model
	decodeData(t, rec, &m)
	if m.Name != "mistral-7b" || m.DisplayName != "Mistral 7B" || m.Phase != PhasePending || m.Placement == nil || m.Rollout.Strategy != StrategyProgressive {
		t.Errorf("created = %+v", m)
	}
	sent := fake.LastCreateModel.GetObject()
	if sent.GetMetadata().GetAnnotations()[AnnotationDisplayName] != "Mistral 7B" || sent.GetMetadata().GetAnnotations()[AnnotationDescription] != "EU sites" || sent.GetMetadata().GetLabels()["ai-grid/family"] != "mistral" {
		t.Errorf("annotations/labels = %v", sent.GetMetadata())
	}
	spec := sent.GetSpec()
	if spec.GetModel().GetUri() != "oci://registry.example.com/models/mistral:v0.3" || spec.GetModel().GetName() != "example-org/mistral-7b" || spec.GetReplicas() != 2 || spec.GetBaseRefs()[0] != "v3-6-0-kserve-config-llm-template" {
		t.Errorf("spec = %v", spec)
	}
	if main := spec.GetMain(); main.GetImage() != "quay.io/example/vllm-cuda:v0.11.0" || main.GetRequests()[ResourceCPU] != "8" || main.GetRequests()[ResourceMemory] != "32Gi" || main.GetRequests()[ResourceGPU] != "1" || main.GetLimits()[ResourceGPU] != "1" || main.GetEnv()[0].GetValue() != "--max-model-len 8192" {
		t.Errorf("main = %v", main)
	}
	if r := spec.GetRouter(); !r.GetManagedRoute() || !r.GetScheduler() || r.GetGatewayRefs()[0].GetName() != DefaultGatewayName || r.GetGatewayRefs()[0].GetNamespace() != DefaultGatewayNamespace {
		t.Errorf("router = %v", r)
	}
	if p := spec.GetPlacement(); p.GetLabelSelector().GetMatchLabels()["ai-grid/enabled"] != "true" || p.GetLabelSelector().GetMatchExpressions()[0].GetValues()[1] != "madrid" || p.GetTolerations()[0].GetTolerationSeconds() != 600 || p.GetNumberOfClusters() != 2 {
		t.Errorf("placement = %v", p)
	}
	if r := spec.GetRollout(); r.GetStrategy() != aigridv1.RolloutStrategy_ROLLOUT_STRATEGY_PROGRESSIVE || r.GetMaxConcurrency() != "1" || r.GetProgressDeadline() != "15m" {
		t.Errorf("rollout = %v", r)
	}

	// Scaling becomes a keda block with its triggers.
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "scaled", "namespace": "ai-grid-models", "modelUri": "hf://example-org/scaled", "scaling": {"minReplicas": 1, "maxReplicas": 4, "triggers": [{"type": "prometheus", "metadata": {"query": "vllm:num_requests_waiting"}}]}}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if sc := fake.LastCreateModel.GetObject().GetSpec().GetScaling(); !sc.GetKeda() || sc.GetMinReplicas() != 1 || sc.GetMaxReplicas() != 4 || len(sc.GetTriggers()) != 1 || sc.GetTriggers()[0].GetType() != "prometheus" || sc.GetTriggers()[0].GetMetadata()["query"] != "vllm:num_requests_waiting" {
		t.Errorf("scaling = %v", sc)
	}
	var scaled Model
	decodeData(t, rec, &scaled)
	if scaled.Scaling == nil || scaled.Scaling.MaxReplicas != 4 || len(scaled.Scaling.Triggers) != 1 || scaled.Replicas != nil {
		t.Errorf("scaled = %+v", scaled)
	}

	// A hub-only model: no placement, no GPU request without gpuCount.
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "cpu-only", "namespace": "ai-grid-models", "modelUri": "hf://example-org/cpu-only"}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if sent := fake.LastCreateModel.GetObject(); sent.GetSpec().GetPlacement() != nil || sent.GetSpec().Replicas != nil || len(sent.GetSpec().GetMain().GetRequests()) != 0 || sent.GetSpec().GetRollout() != nil {
		t.Errorf("hub-only = %v", sent.GetSpec())
	}

	calls := len(fake.Calls)
	for _, tc := range []struct {
		name, body string
		code       int
		message    string
	}{
		{"unknown field", `{"name": "x", "namespace": "n", "modelUri": "hf://x", "locations": ["a"]}`, http.StatusUnprocessableEntity, `invalid request body: json: unknown field "locations"`},
		{"bad strategy", `{"name": "x", "namespace": "n", "modelUri": "hf://x", "placement": {}, "rollout": {"strategy": "Canary"}}`, http.StatusUnprocessableEntity, "rollout.strategy must be All, Progressive or ProgressivePerGroup"},
		{"negative gpu", `{"name": "x", "namespace": "n", "modelUri": "hf://x", "gpuCount": -1}`, http.StatusUnprocessableEntity, "gpuCount must not be negative"},
		{"malformed", `{"name": `, http.StatusUnprocessableEntity, "invalid request body: malformed JSON"},
		{"null", `null`, http.StatusUnprocessableEntity, "invalid request body: must be a JSON object"},
	} {
		rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/models", tc.body))
		if rec.Code != tc.code || decodeError(t, rec).Error.Message != tc.message {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}
	if len(fake.Calls) != calls {
		t.Errorf("an invalid body must not reach the backend: %v", fake.Calls[calls:])
	}

	// Backend answers: the CRD's message as 422, a taken name as 409, the gate as 412.
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "tiny-llm", "namespace": "ai-grid-models", "modelUri": "hf://x"}`))
	if rec.Code != http.StatusConflict || decodeError(t, rec).Error.Message != `llminferenceservices.serving.kserve.io "tiny-llm" already exists` {
		t.Errorf("duplicate = %d %s", rec.Code, rec.Body.String())
	}
	fake.Errs = map[string]error{"CreateModel": backendtest.Status(codes.FailedPrecondition, "ManifestWorkReplicaSet feature gate disabled on hub")}
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "y", "namespace": "n", "modelUri": "hf://y", "placement": {}}`))
	if rec.Code != http.StatusPreconditionFailed || decodeError(t, rec).Error.Message != "ManifestWorkReplicaSet feature gate disabled on hub" {
		t.Errorf("gate off = %d %s", rec.Code, rec.Body.String())
	}
	fake.Errs = map[string]error{"CreateModel": backendtest.Status(codes.InvalidArgument, "either wva or keda must be specified when scaling is configured")}
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "y", "namespace": "n", "modelUri": "hf://y"}`))
	if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != "either wva or keda must be specified when scaling is configured" {
		t.Errorf("CRD message = %d %s", rec.Code, rec.Body.String())
	}
	fake.Errs = map[string]error{"CreateModel": backendtest.Status(codes.PermissionDenied, `User "alice" is not a provider admin: cannot patch resource "managedclusters" in API group "cluster.open-cluster-management.io" at the cluster scope`)}
	if rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/models", `{"name": "y", "namespace": "n", "modelUri": "hf://y"}`)); rec.Code != http.StatusForbidden {
		t.Errorf("viewer = %d", rec.Code)
	}
}

func TestPatchModel(t *testing.T) {
	fake := &backendtest.Fake{Models: seedModels()}
	app := newTestApp(t, testConfig(t), fake)
	rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", `{"replicas": 3, "runtimeImage": "quay.io/example/vllm:v2", "env": [], "displayName": "Tiny LLM v2", "labels": {"team": "a"}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	var m Model
	decodeData(t, rec, &m)
	if m.Replicas == nil || *m.Replicas != 3 || m.RuntimeImage != "quay.io/example/vllm:v2" || len(m.Env) != 0 || m.DisplayName != "Tiny LLM v2" || m.Description != "CPU smoke test" || m.Labels["team"] != "a" || m.ResourceVersion != "8" {
		t.Errorf("patched = %+v", m)
	}
	req := fake.LastUpdateModel
	if !req.GetLock() || req.GetObject().GetMetadata().GetResourceVersion() != "7" || strings.Join(req.GetUpdateMask().GetPaths(), ",") != "spec.replicas,spec.main.image,spec.main.env,metadata.labels,metadata.annotations" {
		t.Errorf("update request = %v", req)
	}
	if ann := req.GetObject().GetMetadata().GetAnnotations(); ann[AnnotationDisplayName] != "Tiny LLM v2" || ann[AnnotationDescription] != "CPU smoke test" {
		t.Errorf("display name merged into the stored annotations: %v", ann)
	}
	if len(req.GetObject().GetSpec().GetMain().GetEnv()) != 0 {
		t.Errorf("env: [] clears the variables (the mask path carries the intent), sent %v", req.GetObject().GetSpec().GetMain())
	}

	// Placement and rollout, then placement removed.
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", `{"placement": {"matchLabels": {"ai-grid/enabled": "true"}}, "rollout": {"strategy": "All", "progressDeadline": "10m"}}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	req = fake.LastUpdateModel
	if strings.Join(req.GetUpdateMask().GetPaths(), ",") != "spec.placement,spec.rollout" || req.GetObject().GetSpec().GetPlacement().GetLabelSelector().GetMatchLabels()["ai-grid/enabled"] != "true" || req.GetObject().GetSpec().GetRollout().GetProgressDeadline() != "10m" {
		t.Errorf("placement update = %v", req)
	}
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", `{"placement": null}`))
	if rec.Code != http.StatusOK || fake.LastUpdateModel.GetObject().GetSpec().GetPlacement() != nil || strings.Join(fake.LastUpdateModel.GetUpdateMask().GetPaths(), ",") != "spec.placement" {
		t.Errorf("placement: null removes it: %d %v", rec.Code, fake.LastUpdateModel)
	}

	// An empty patch reads and answers without a write.
	calls := len(fake.Calls)
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", `{}`))
	if rec.Code != http.StatusOK || len(fake.Calls) != calls+1 || fake.Calls[calls] != "GetModel" {
		t.Errorf("empty patch = %d, calls %v", rec.Code, fake.Calls[calls:])
	}
	for _, tc := range []struct{ body, message string }{
		{`{"nope": 1}`, `invalid request body: json: unknown field "nope"`},
		{`{"rollout": {"strategy": "Blue"}}`, "rollout.strategy must be All, Progressive or ProgressivePerGroup"},
		{`{"placement": {"nope": 1}}`, `invalid request body: json: unknown field "nope"`},
	} {
		rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", tc.body))
		if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != tc.message {
			t.Errorf("%s: %d %s", tc.body, rec.Code, rec.Body.String())
		}
	}
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/nope", `{"replicas": 1}`))
	if rec.Code != http.StatusNotFound {
		t.Errorf("unknown model = %d", rec.Code)
	}
	// A write that lands between the read and the update is a 409.
	fake.AfterGetModel = func(stored *aigridv1.Model) { stored.Metadata.ResourceVersion = "99" }
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/models/ai-grid-models/tiny-llm", `{"replicas": 4}`))
	if rec.Code != http.StatusConflict {
		t.Errorf("stale write = %d %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteModel(t *testing.T) {
	fake := &backendtest.Fake{Models: seedModels()}
	app := newTestApp(t, testConfig(t), fake)
	rec := serve(app, asUser(http.MethodDelete, "/api/v1/models/team-b/other"))
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 || fake.LastDeleteModel.GetNamespace() != "team-b" || fake.LastDeleteModel.GetName() != "other" {
		t.Errorf("delete = %d %q %v", rec.Code, rec.Body.String(), fake.LastDeleteModel)
	}
	if rec := serve(app, asUser(http.MethodDelete, "/api/v1/models/team-b/other")); rec.Code != http.StatusNotFound {
		t.Errorf("second delete = %d", rec.Code)
	}
	fake.Errs = map[string]error{"DeleteModel": backendtest.Status(codes.FailedPrecondition, "model ai-grid-models/tiny-llm is referenced by subscription acme/gold; remove those references first")}
	rec = serve(app, asUser(http.MethodDelete, "/api/v1/models/ai-grid-models/tiny-llm"))
	if rec.Code != http.StatusPreconditionFailed || !strings.Contains(decodeError(t, rec).Error.Message, "referenced by") {
		t.Errorf("referenced = %d %s", rec.Code, rec.Body.String())
	}
}

func TestCapabilities(t *testing.T) {
	fake := &backendtest.Fake{}
	app := newTestApp(t, testConfig(t), fake)
	rec := serve(app, asUser(http.MethodGet, "/api/v1/capabilities"))
	if rec.Code != http.StatusNotImplemented {
		t.Errorf("today's backend has no GetHubCapabilities: %d %s", rec.Code, rec.Body.String())
	}
	fake.Capabilities = &aigridv1.HubCapabilities{ManifestWorkReplicaSetEnabled: false, ObservabilityInstalled: true, AcmVersion: "2.17.3"}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/capabilities"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	var c Capabilities
	decodeData(t, rec, &c)
	if c.ManifestWorkReplicaSetEnabled || !c.ObservabilityInstalled || c.ACMVersion != "2.17.3" {
		t.Errorf("capabilities = %+v", c)
	}
	if !strings.Contains(rec.Body.String(), `"manifestWorkReplicaSetEnabled":false`) {
		t.Errorf("false is serialised, not omitted: %s", rec.Body.String())
	}
}

func TestModelFromTodaysShapes(t *testing.T) {
	// A model without status, scaling or router renders with empty collections
	// and the name as model name, never nulls.
	m := toModel(&aigridv1.Model{Name: "bare", Metadata: &aigridv1.ObjectMeta{Namespace: "ns"}, Spec: &aigridv1.ModelSpec{Model: &aigridv1.ModelSource{Uri: "hf://x"}}})
	if m.ModelName != "bare" || m.Phase != "" || m.BaseRefs == nil || m.Requests == nil || m.Limits == nil || m.Env == nil || m.Gateways == nil || m.Addresses == nil || m.Conditions == nil || m.AppliedConfigs == nil || m.Labels == nil || m.Annotations == nil || m.Placement != nil {
		t.Errorf("bare = %+v", m)
	}
	// A placed model whose backend sent no rollout status still has a
	// placement with empty collections.
	m = toModel(&aigridv1.Model{Name: "p", Metadata: &aigridv1.ObjectMeta{Namespace: "ns"}, Spec: &aigridv1.ModelSpec{Placement: &aigridv1.Placement{}}})
	if m.Placement == nil || m.Placement.SelectedClusters == nil || m.Placement.Conditions == nil || m.Rollout == nil || m.Rollout.Works == nil || m.Rollout.Strategy != StrategyAll {
		t.Errorf("placed = %+v", m)
	}
}
