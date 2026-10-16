package fakebackend

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Strings KServe writes on an LLMInferenceService (serving.kserve.io/v1alpha2).
// Every value comes from mock/research/models-maas.md section 2.1, which cites
// the controller source for each one (kserve:llm_inference_service_lifecycle.go,
// config_merge.go, workload_single_node.go, router.go); nothing here is
// invented unless its comment says so. Keep them verbatim: the UI and the real
// backend will match on them.
const (
	// Condition types. `Ready` rolls up PresetsCombined, WorkloadsReady and
	// RouterReady (Knative LivingConditionSet); WorkloadsReady rolls up
	// MainWorkloadReady; RouterReady rolls up GatewaysReady, HTTPRoutesReady,
	// InferencePoolReady and SchedulerWorkloadReady.
	CondReady                  = "Ready"
	CondPresetsCombined        = "PresetsCombined"
	CondWorkloadsReady         = "WorkloadsReady"
	CondMainWorkloadReady      = "MainWorkloadReady"
	CondRouterReady            = "RouterReady"
	CondGatewaysReady          = "GatewaysReady"
	CondHTTPRoutesReady        = "HTTPRoutesReady"
	CondInferencePoolReady     = "InferencePoolReady"
	CondSchedulerWorkloadReady = "SchedulerWorkloadReady"

	// PresetsCombined False (config_merge.go). The message format is
	// kserve:config_merge.go:1283, `%v` of the namespaces searched.
	ReasonConfigNotFound    = "ConfigNotFound"
	MessageConfigNotFoundFm = "LLMInferenceServiceConfig %q not found in namespaces %v"

	// MainWorkloadReady False: KServe copies the Deployment's own conditions
	// (kserve:workload_single_node.go:418-443). Available=False gives
	// MinimumReplicasUnavailable with the Deployment's message; Progressing=False
	// gives ProgressDeadlineExceeded with the Deployment's message (the
	// deployment controller's `ReplicaSet %q has timed out progressing.`); no
	// Deployment condition yet gives Progressing with an empty message.
	ReasonMinimumReplicasUnavailable  = "MinimumReplicasUnavailable"
	MessageMinimumReplicasUnavailable = "Deployment does not have minimum availability."
	ReasonProgressDeadlineExceeded    = "ProgressDeadlineExceeded"
	MessageProgressDeadlineExceededFm = "ReplicaSet %q has timed out progressing."
	ReasonProgressing                 = "Progressing"

	// GatewaysReady False (router.go). The message lists `<ns>/<name>` pairs.
	ReasonGatewaysNotReady    = "GatewaysNotReady"
	MessageGatewaysNotReadyFm = "The following Gateways are not ready: %v"

	// HTTPRoutesReady False (kserve:router.go:732 and :771-772). For a managed
	// route (`route: {}`, the console's case) the controller creates
	// `<name>-kserve-route` and, until a Gateway controller accepts it, reports
	// WaitingForGateway listing the routes; HTTPRouteNotObserved is only
	// reported for an inline route spec (`route.http.spec`), which the console
	// does not write, so the fake never produces it. Whether the hub's RHOAI
	// 3.6 build still reports HTTPRouteNotObserved for a managed route could
	// not be settled read-only (sha-pinned images); the fake follows the source.
	ReasonHTTPRouteNotObserved  = "HTTPRouteNotObserved"
	MessageHTTPRouteNotObserved = "The managed HTTPRoute has not been observed yet"
	ReasonWaitingForGateway     = "WaitingForGateway"
	MessageWaitingForGatewayFm  = "The following HTTPRoutes exist but no Gateway controller has accepted them yet: %v"
	managedRouteSuffix          = "-kserve-route"

	// `status.addresses[].name` values (kserve:router_discovery_filter.go).
	AddressGatewayExternal             = "gateway-external"
	AddressGatewayExternalModelRouting = "gateway-external-model-routing"
	AddressGatewayInternal             = "gateway-internal"
	AddressGatewayInternalModelRouting = "gateway-internal-model-routing"

	// `status.appliedConfigs[].source` values.
	AppliedConfigPreset  = "Preset"
	AppliedConfigUserRef = "UserRef"

	// Gateway API group and kind of an address origin.
	GatewayGroup = "gateway.networking.k8s.io"
	GatewayKind  = "Gateway"

	// Gateways on the hub (models-maas.md section 1, `openshift-ingress`).
	// `openshift-ai-inference` is the default Gateway KServe programs; the
	// MaaS one is `maas-default-gateway`.
	GatewayNamespace   = "openshift-ingress"
	GatewayAIInference = "openshift-ai-inference"
	GatewayMaaSDefault = "maas-default-gateway"
	defaultGatewayName = GatewayAIInference
	defaultGatewayNS   = GatewayNamespace
	workloadsAPIGroup  = "apps"
	workloadsKind      = "Deployment"
	workloadMainSuffix = "-kserve"
	// The scheduler Deployment is `<name>-kserve-router-scheduler`
	// (kserve:scheduler.go, `kmeta.ChildName(name, "-kserve-router-scheduler")`,
	// confirmed on the hub instance); `<name>-kserve-scheduler` is the EPP
	// Service. The workload Service is `<name>-kserve-workload-svc`
	// (kserve:workload.go).
	workloadSchedSuffix = "-kserve-router-scheduler"
	workloadSvcSuffix   = "-kserve-workload-svc"
	serviceKind         = "Service"

	// Presets the controller merges under every spec (status.appliedConfigs
	// on the hub instance: scheduler, router-route, template as Preset, then
	// the baseRefs as UserRef). Their names are versioned by RHOAI release;
	// presets.json carries the installed list (models-maas.md open question 10).
	PresetTemplate    = "v3-6-0-kserve-config-llm-template"
	PresetScheduler   = "v3-6-0-kserve-config-llm-scheduler"
	PresetRouterRoute = "v3-6-0-kserve-config-llm-router-route"
	// PresetsNamespace is where RHOAI installs the LLMInferenceServiceConfigs.
	PresetsNamespace = "redhat-ods-applications"

	// Annotations the display name and description live in (the OpenShift
	// convention the POC and the ODH dashboard use, models-maas.md 7.3).
	AnnotationDisplayName = "openshift.io/display-name"
	AnnotationDescription = "openshift.io/description"

	// URI schemes `spec.model.uri` accepts (models-maas.md 2.1).
	schemeHF  = "hf://"
	schemeS3  = "s3://"
	schemePVC = "pvc://"
	schemeOCI = "oci://"

	// hubAppsDomain is the invented wildcard domain of the hub's Gateway load
	// balancer; the spoke domains are `apps.<cluster>.example.com`, matching the
	// console URLs in managedclusters.json.
	hubAppsDomain = "apps.hub.example.com"
)

// Stage offsets of the LLMInferenceService lifecycle, in scenario seconds
// (divided by the settings' `speed`), following models-maas.md 8.2: the
// controller's first reconcile, the route being accepted and the Deployment
// created, the Deployment reporting Available=False, the pods ready, and the
// Deployment's default progressDeadlineSeconds (600) for a workload that never
// becomes ready.
const (
	llmisvcT1       = 5 * time.Second
	llmisvcT2       = 15 * time.Second
	llmisvcT2b      = 20 * time.Second
	llmisvcT3       = 45 * time.Second
	llmisvcDeadline = 600 * time.Second
)

// Condition status values, short names for the derivations below.
const (
	cTrue    = aigridv1.ConditionStatus_CONDITION_STATUS_TRUE
	cFalse   = aigridv1.ConditionStatus_CONDITION_STATUS_FALSE
	cUnknown = aigridv1.ConditionStatus_CONDITION_STATUS_UNSPECIFIED
)

// uriSchemes lists the accepted `spec.model.uri` prefixes.
var uriSchemes = []string{schemeHF, schemeS3, schemePVC, schemeOCI}

// knownGateways are the Gateways that are Programmed on the hub; any other
// reference yields GatewaysReady=False/GatewaysNotReady.
var knownGateways = map[string]bool{
	GatewayNamespace + "/" + GatewayAIInference: true,
	GatewayNamespace + "/" + GatewayMaaSDefault: true,
}

// stuckMarkers select the "pods never become ready" failure mode when found in
// the image or the model name (models-maas.md 8.2).
var stuckMarkers = []string{"oom", "fail"}

// llmisvcInput is everything the lifecycle depends on, extracted once from a
// Model so the replay below is a pure function of (input, time).
type llmisvcInput struct {
	name, namespace string
	modelName       string
	baseRefs        []string
	gateways        []*aigridv1.GatewayRef
	scheduler       bool
	managedRoute    bool
	replicas        int32
	generation      int64
	// appsDomain is the wildcard domain the external addresses use.
	appsDomain string
	// unknownPreset is the first baseRef not installed, or "" when all are.
	unknownPreset string
	// presetsNamespace is where the presets live, for the ConfigNotFound message.
	presetsNamespace string
	// stuck: the workload never reaches minimum availability.
	stuck bool
	// badGateway is the first referenced Gateway that is not Programmed.
	badGateway *aigridv1.GatewayRef
}

// newLLMISvcInput reads the lifecycle inputs from a model for a given cluster
// domain. presets is the installed LLMInferenceServiceConfig list.
func newLLMISvcInput(m *aigridv1.Model, presets *Presets, appsDomain string) llmisvcInput {
	spec := m.GetSpec()
	in := llmisvcInput{
		name:             m.GetName(),
		namespace:        m.GetMetadata().GetNamespace(),
		modelName:        spec.GetModel().GetName(),
		baseRefs:         spec.GetBaseRefs(),
		gateways:         spec.GetRouter().GetGatewayRefs(),
		scheduler:        spec.GetRouter().GetScheduler(),
		managedRoute:     spec.GetRouter().GetManagedRoute(),
		replicas:         spec.GetReplicas(),
		generation:       m.GetMetadata().GetGeneration(),
		appsDomain:       appsDomain,
		presetsNamespace: presets.Namespace,
	}
	if in.modelName == "" {
		in.modelName = in.name // llm_inference_service_defaults.go
	}
	if spec.Replicas == nil {
		in.replicas = 1
		if sc := spec.GetScaling(); sc != nil {
			in.replicas = max(sc.GetMinReplicas(), 1)
		}
	}
	if len(in.gateways) == 0 {
		in.gateways = []*aigridv1.GatewayRef{{Name: defaultGatewayName, Namespace: defaultGatewayNS}}
	}
	for _, ref := range in.baseRefs {
		if !slices.Contains(presets.Names, ref) {
			in.unknownPreset = ref
			break
		}
	}
	for _, gw := range in.gateways {
		if !knownGateways[gw.GetNamespace()+"/"+gw.GetName()] {
			in.badGateway = gw
			break
		}
	}
	image := strings.ToLower(spec.GetMain().GetImage())
	modelName := strings.ToLower(in.modelName)
	for _, marker := range stuckMarkers {
		if strings.Contains(image, marker) || strings.Contains(modelName, marker) {
			in.stuck = true
		}
	}
	return in
}

// Presets is the installed LLMInferenceServiceConfig list (presets.json).
type Presets struct {
	// Namespace the presets live in.
	Namespace string `json:"namespace"`
	// Names of the installed presets; `baseRefs` are validated against them.
	Names []string `json:"presets"`
}

// defaultPresets is what the fake uses when presets.json is absent: the
// presets the hub instance's appliedConfigs show.
func defaultPresets() *Presets {
	return &Presets{Namespace: PresetsNamespace, Names: []string{PresetTemplate, PresetScheduler, PresetRouterRoute, "v3-6-0-kserve-config-llm-template-cpu"}}
}

// llmisvcEvent is one controller write in the lifecycle replay.
type llmisvcEvent struct {
	at    time.Duration
	apply func(st *aigridv1.ModelStatus, now time.Time)
}

// llmisvcGeneration is one generation of the spec: the lifecycle inputs it
// produced and the elapsed offset (from creation) at which it was written.
// Generation 1 is at offset zero.
type llmisvcGeneration struct {
	in llmisvcInput
	at time.Duration
}

// llmisvcStatus derives the LLMInferenceService status at `elapsed` after
// creation by replaying the controller's writes in order, each stamped with
// the time it happened, so lastTransitionTime moves only when a status
// changes, exactly as a controller leaves it. `gens` are the generations of
// the spec in order (the first at offset zero); each one's events are derived
// from its own inputs, and the events of a generation that a newer one
// supersedes before they happen are dropped: a controller that sees a new
// generation reconciles the new spec, so a Deployment rollout of the old one
// can never mark the new one Ready. `at(offset)` converts an offset into wall
// time. It also returns the offset of the last `Ready` status change (zero
// when `Ready` was never written), which the work agent's condition rules
// need.
func llmisvcStatus(gens []llmisvcGeneration, elapsed time.Duration, at func(time.Duration) time.Time) (*aigridv1.ModelStatus, time.Duration) {
	st := &aigridv1.ModelStatus{}
	var events []llmisvcEvent
	for i, g := range gens {
		var own []llmisvcEvent
		switch {
		case i == 0 || !gens[i-1].in.deploys():
			// First generation, or the previous one never created the
			// workload (stopped at the presets or the Gateway): the whole
			// lifecycle runs for this spec.
			own = llmisvcEvents(g.in, g.at, int64(i)+1)
		default:
			own = llmisvcRestartEvents(g.in, g.at, int64(i)+1)
		}
		if i+1 < len(gens) {
			cutoff := gens[i+1].at
			own = slices.DeleteFunc(own, func(ev llmisvcEvent) bool { return ev.at >= cutoff })
		}
		events = append(events, own...)
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].at < events[j].at })
	var readyAt time.Duration
	for _, ev := range events {
		if ev.at > elapsed {
			break
		}
		before := condition(st.Conditions, CondReady)
		wasSet, was := before != nil, before.GetStatus()
		ev.apply(st, at(ev.at))
		if after := condition(st.Conditions, CondReady); after != nil && (!wasSet || after.GetStatus() != was) {
			readyAt = ev.at
		}
	}
	sort.SliceStable(st.Conditions, func(i, j int) bool { return st.Conditions[i].GetType() < st.Conditions[j].GetType() }) // Knative sorts by type
	return st, readyAt
}

// deploys reports whether the controller gets past the presets and the
// Gateway check and creates the workload for this spec.
func (in llmisvcInput) deploys() bool { return in.unknownPreset == "" && in.badGateway == nil }

// terminalReadyReasons are the `Ready=False` reasons that mean the model will
// not recover on its own: a missing preset, a Gateway that is not programmed,
// a Deployment past its progress deadline. The other False reasons
// (`WaitingForGateway`, `Progressing`, `MinimumReplicasUnavailable`) are
// what KServe reports while a healthy model starts. The console's
// ManifestWork template encodes this set in its Degraded condition rule:
//
//	object.status.conditions.exists(c, c.type == "Ready" && c.status == "False"
//	  && c.reason in ["ConfigNotFound", "GatewaysNotReady", "ProgressDeadlineExceeded"])
//
// so a spoke that is merely starting is Progressing, not Degraded.
var terminalReadyReasons = map[string]bool{ReasonConfigNotFound: true, ReasonGatewaysNotReady: true, ReasonProgressDeadlineExceeded: true}

// isTerminalFailure applies terminalReadyReasons to a `Ready` condition.
func isTerminalFailure(ready *aigridv1.Condition) bool {
	return ready.GetStatus() == cFalse && terminalReadyReasons[ready.GetReason()]
}

// llmisvcEvents is the lifecycle from creation at `base`, generation `gen`.
func llmisvcEvents(in llmisvcInput, base time.Duration, gen int64) []llmisvcEvent {
	// T1: presets merged, Gateways checked, the managed HTTPRoute created but
	// not yet observed by a parent.
	t1 := func(st *aigridv1.ModelStatus, now time.Time) {
		st.ObservedGeneration = gen
		if in.unknownPreset != "" {
			msg := fmt.Sprintf(MessageConfigNotFoundFm, in.unknownPreset, []string{in.namespace, in.presetsNamespace})
			setModelCondition(st, now, CondPresetsCombined, cFalse, ReasonConfigNotFound, msg)
			setModelCondition(st, now, CondReady, cFalse, ReasonConfigNotFound, msg)
			return
		}
		setModelCondition(st, now, CondPresetsCombined, cTrue, "", "")
		st.AppliedConfigs = appliedConfigs(in)
		routesMsg := fmt.Sprintf(MessageWaitingForGatewayFm, []string{in.namespace + "/" + in.name + managedRouteSuffix})
		if in.badGateway != nil {
			msg := fmt.Sprintf(MessageGatewaysNotReadyFm, []string{in.badGateway.GetNamespace() + "/" + in.badGateway.GetName()})
			setModelCondition(st, now, CondGatewaysReady, cFalse, ReasonGatewaysNotReady, msg)
			setModelCondition(st, now, CondHTTPRoutesReady, cFalse, ReasonWaitingForGateway, routesMsg)
			setModelCondition(st, now, CondRouterReady, cFalse, ReasonGatewaysNotReady, msg)
			setModelCondition(st, now, CondReady, cFalse, ReasonGatewaysNotReady, msg)
			return
		}
		setModelCondition(st, now, CondGatewaysReady, cTrue, "", "")
		setModelCondition(st, now, CondHTTPRoutesReady, cFalse, ReasonWaitingForGateway, routesMsg)
		setModelCondition(st, now, CondRouterReady, cFalse, ReasonWaitingForGateway, routesMsg)
		setModelCondition(st, now, CondReady, cFalse, ReasonWaitingForGateway, routesMsg)
	}
	if !in.deploys() {
		return []llmisvcEvent{{base + llmisvcT1, t1}} // never progresses
	}
	// T2: route accepted, scheduler up, Deployment created without conditions.
	t2 := func(st *aigridv1.ModelStatus, now time.Time) {
		setModelCondition(st, now, CondHTTPRoutesReady, cTrue, "", "")
		if in.scheduler {
			setModelCondition(st, now, CondInferencePoolReady, cTrue, "", "")
			setModelCondition(st, now, CondSchedulerWorkloadReady, cTrue, "", "")
		}
		setModelCondition(st, now, CondRouterReady, cTrue, "", "")
		st.Workloads = workloads(in, 0)
		setModelCondition(st, now, CondMainWorkloadReady, cFalse, ReasonProgressing, "")
		setModelCondition(st, now, CondWorkloadsReady, cFalse, ReasonProgressing, "")
		setModelCondition(st, now, CondReady, cFalse, ReasonProgressing, "")
	}
	return append([]llmisvcEvent{{base + llmisvcT1, t1}, {base + llmisvcT2, t2}}, llmisvcWorkloadEvents(in, base)...)
}

// llmisvcRestartEvents is what a spec change does: the controller observes the
// new generation and the Deployment rolls out again.
func llmisvcRestartEvents(in llmisvcInput, base time.Duration, gen int64) []llmisvcEvent {
	if !in.deploys() {
		// The new spec fails admission by the controller: the presets or
		// the Gateway check now fail, as on a first reconcile.
		return llmisvcEvents(in, base, gen)
	}
	restart := func(st *aigridv1.ModelStatus, now time.Time) {
		st.ObservedGeneration = gen
		st.Url = ""
		st.Addresses = nil
		st.Workloads = workloads(in, 0)
		setModelCondition(st, now, CondMainWorkloadReady, cFalse, ReasonProgressing, "")
		setModelCondition(st, now, CondWorkloadsReady, cFalse, ReasonProgressing, "")
		setModelCondition(st, now, CondReady, cFalse, ReasonProgressing, "")
	}
	return append([]llmisvcEvent{{base + llmisvcT2, restart}}, llmisvcWorkloadEvents(in, base)...)
}

// llmisvcWorkloadEvents are the Deployment's reports after it was created at
// base+T2: Available=False, then either the pods ready or, for a stuck
// workload, the progress deadline.
func llmisvcWorkloadEvents(in llmisvcInput, base time.Duration) []llmisvcEvent {
	t2b := func(st *aigridv1.ModelStatus, now time.Time) {
		setModelCondition(st, now, CondMainWorkloadReady, cFalse, ReasonMinimumReplicasUnavailable, MessageMinimumReplicasUnavailable)
		setModelCondition(st, now, CondWorkloadsReady, cFalse, ReasonMinimumReplicasUnavailable, MessageMinimumReplicasUnavailable)
		setModelCondition(st, now, CondReady, cFalse, ReasonMinimumReplicasUnavailable, MessageMinimumReplicasUnavailable)
	}
	if in.stuck {
		deadline := func(st *aigridv1.ModelStatus, now time.Time) {
			msg := fmt.Sprintf(MessageProgressDeadlineExceededFm, in.name+workloadMainSuffix+"-"+replicaSetHash(in.name, st.GetObservedGeneration()))
			setModelCondition(st, now, CondMainWorkloadReady, cFalse, ReasonProgressDeadlineExceeded, msg)
			setModelCondition(st, now, CondWorkloadsReady, cFalse, ReasonProgressDeadlineExceeded, msg)
			setModelCondition(st, now, CondReady, cFalse, ReasonProgressDeadlineExceeded, msg)
		}
		return []llmisvcEvent{{base + llmisvcT2b, t2b}, {base + llmisvcT2 + llmisvcDeadline, deadline}}
	}
	t3 := func(st *aigridv1.ModelStatus, now time.Time) {
		setModelCondition(st, now, CondMainWorkloadReady, cTrue, "", "")
		setModelCondition(st, now, CondWorkloadsReady, cTrue, "", "")
		setModelCondition(st, now, CondReady, cTrue, "", "")
		st.Workloads = workloads(in, in.replicas)
		st.Addresses = addresses(in)
		st.Url = st.Addresses[1].GetUrl() // the external path address
	}
	return []llmisvcEvent{{base + llmisvcT2b, t2b}, {base + llmisvcT3, t3}}
}

// replicaSetHash is a stable stand-in for the pod-template hash in a
// ReplicaSet name (ten characters of the Kubernetes hash alphabet).
func replicaSetHash(name string, gen int64) string {
	const alphabet = "bcdfghjklmnpqrstvwxz2456789"
	seed := uint64(gen) * 1099511628211
	for _, r := range name {
		seed = (seed ^ uint64(r)) * 1099511628211
	}
	out := make([]byte, 10)
	for i := range out {
		out[i] = alphabet[seed%uint64(len(alphabet))]
		seed /= 7
		seed = seed*6364136223846793005 + 1442695040888963407
	}
	return string(out)
}

// appliedConfigs lists the presets the controller merges, in merge order:
// scheduler and router-route when those features are on, template always,
// then the user's baseRefs (the hub instance's status.appliedConfigs).
func appliedConfigs(in llmisvcInput) []*aigridv1.AppliedConfig {
	var out []*aigridv1.AppliedConfig
	if in.scheduler {
		out = append(out, &aigridv1.AppliedConfig{Name: PresetScheduler, Namespace: in.presetsNamespace, Source: AppliedConfigPreset})
	}
	if in.managedRoute {
		out = append(out, &aigridv1.AppliedConfig{Name: PresetRouterRoute, Namespace: in.presetsNamespace, Source: AppliedConfigPreset})
	}
	out = append(out, &aigridv1.AppliedConfig{Name: PresetTemplate, Namespace: in.presetsNamespace, Source: AppliedConfigPreset})
	for _, ref := range in.baseRefs {
		out = append(out, &aigridv1.AppliedConfig{Name: ref, Namespace: in.presetsNamespace, Source: AppliedConfigUserRef})
	}
	return out
}

// workloads is `status.workloads` once the Deployments and the workload
// Service exist (names from the hub instance and kserve:workload.go,
// scheduler.go).
func workloads(in llmisvcInput, ready int32) *aigridv1.Workloads {
	w := &aigridv1.Workloads{
		Primary: &aigridv1.WorkloadRef{ApiGroup: workloadsAPIGroup, Kind: workloadsKind, Name: in.name + workloadMainSuffix, ReadyReplicas: ready},
		Service: &aigridv1.WorkloadRef{Kind: serviceKind, Name: in.name + workloadSvcSuffix},
	}
	if in.scheduler {
		schedReady := int32(0)
		if ready > 0 {
			schedReady = 1
		}
		w.Scheduler = &aigridv1.WorkloadRef{ApiGroup: workloadsAPIGroup, Kind: workloadsKind, Name: in.name + workloadSchedSuffix, ReadyReplicas: schedReady}
	}
	return w
}

// addresses is `status.addresses` for a Ready model: per Gateway an external
// and an internal root address (model routing by header, accepting only the
// `publishers/...` identifier) and the `/<ns>/<name>` and
// `/publishers/<ns>/models/<model.name>` path addresses (accepting that and
// the bare model name), models-maas.md 2.1. The external host is the
// Gateway's load balancer, the internal one its Service.
func addresses(in llmisvcInput) []*aigridv1.Address {
	publishers := "publishers/" + in.namespace + "/models/" + in.modelName
	var out []*aigridv1.Address
	for _, gw := range in.gateways {
		origin := &aigridv1.ObjectRef{Group: GatewayGroup, Kind: GatewayKind, Name: gw.GetName(), Namespace: gw.GetNamespace()}
		for _, side := range []struct{ host, name, routing string }{
			{"https://" + gw.GetName() + "." + in.appsDomain, AddressGatewayExternal, AddressGatewayExternalModelRouting},
			{"https://" + gw.GetName() + "-" + gw.GetName() + "." + gw.GetNamespace() + ".svc.cluster.local", AddressGatewayInternal, AddressGatewayInternalModelRouting},
		} {
			out = append(out,
				&aigridv1.Address{Name: side.routing, Url: side.host + "/", Origin: origin, Models: []string{publishers}},
				&aigridv1.Address{Name: side.name, Url: side.host + "/" + in.namespace + "/" + in.name, Origin: origin, Models: []string{publishers, in.modelName}},
				&aigridv1.Address{Name: side.name, Url: side.host + "/" + publishers, Origin: origin, Models: []string{publishers, in.modelName}},
			)
		}
	}
	return out
}

// setModelCondition writes a condition the way KServe does: status, reason and
// message replaced, lastTransitionTime moved only when the status changes. An
// empty reason or message is left unset, as a True Knative condition carries
// neither.
func setModelCondition(st *aigridv1.ModelStatus, now time.Time, typ string, status aigridv1.ConditionStatus, reason, message string) {
	st.Conditions = writeCondition(st.Conditions, now, typ, status, reason, message)
}

// writeCondition is the controller write shared by every status list: a new
// condition is appended with lastTransitionTime=now, an existing one keeps
// its time unless the status changed.
func writeCondition(conds []*aigridv1.Condition, now time.Time, typ string, status aigridv1.ConditionStatus, reason, message string) []*aigridv1.Condition {
	var cond *aigridv1.Condition
	for _, c := range conds {
		if c.GetType() == typ {
			cond = c
			break
		}
	}
	if cond == nil {
		cond = &aigridv1.Condition{Type: typ, LastTransitionTime: timestamppb.New(now)}
		conds = append(conds, cond)
	} else if cond.GetStatus() != status {
		cond.LastTransitionTime = timestamppb.New(now)
	}
	cond.Status = status
	cond.Reason, cond.Message = nil, nil
	if reason != "" {
		cond.Reason = proto.String(reason)
	}
	if message != "" {
		cond.Message = proto.String(message)
	}
	return conds
}

// condition returns the condition of that type from a list, or nil.
func condition(conds []*aigridv1.Condition, typ string) *aigridv1.Condition {
	for _, c := range conds {
		if c.GetType() == typ {
			return c
		}
	}
	return nil
}

// conditionStatusString is the Kubernetes spelling of a condition status.
func conditionStatusString(st aigridv1.ConditionStatus) string {
	switch st {
	case cTrue:
		return "True"
	case cFalse:
		return "False"
	default:
		return "Unknown"
	}
}

// deriveHubPhase is the phase derivation for a hub deployment
// (models-maas.md 2.1): Ready True -> READY, False -> FAILED with its reason
// and message, absent or Unknown -> PENDING.
func deriveHubPhase(st *aigridv1.ModelStatus) (aigridv1.ModelPhase, string, string) {
	ready := condition(st.GetConditions(), CondReady)
	switch ready.GetStatus() {
	case cTrue:
		return aigridv1.ModelPhase_MODEL_PHASE_READY, "", ""
	case cFalse:
		return aigridv1.ModelPhase_MODEL_PHASE_FAILED, ready.GetReason(), ready.GetMessage()
	default:
		return aigridv1.ModelPhase_MODEL_PHASE_PENDING, ready.GetReason(), ready.GetMessage()
	}
}
