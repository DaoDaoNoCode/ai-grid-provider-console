package fakebackend

import (
	"crypto/rand"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Strings the work agent writes on a ManifestWork and the hub's
// ManifestWorkReplicaSet controller writes on a ManifestWorkReplicaSet. Every
// value comes from mock/research/acm.md section 4, which cites
// ocm:pkg/work/spoke (agent) and ocm:pkg/work/hub (controller); nothing here is
// invented unless its comment says so.
const (
	// ManifestWork conditions (agent).
	CondWorkApplied     = "Applied"
	CondWorkAvailable   = "Available"
	CondWorkProgressing = "Progressing"
	CondWorkDegraded    = "Degraded"

	ReasonAppliedManifestWorkComplete  = "AppliedManifestWorkComplete"
	MessageAppliedManifestWorkComplete = "Apply manifest work complete"
	ReasonAppliedManifestWorkFailed    = "AppliedManifestWorkFailed"
	MessageAppliedManifestWorkFailed   = "Failed to apply manifest work"
	ReasonResourcesAvailable           = "ResourcesAvailable"
	MessageResourcesAvailable          = "All resources are available"
	ReasonResourcesNotAvailable        = "ResourcesNotAvailable"
	MessageResourcesNotAvailableFm     = "%d of %d resources are not available"
	// Rule-derived work conditions: reason, and the message when more than one
	// manifest carries the condition (a single one has its message copied).
	ReasonConditionRulesAggregated = "ConditionRulesAggregated"
	MessageAggregatedFm            = "Aggregated from %d manifest conditions"

	// Manifest-level conditions (agent).
	CondManifestStatusFeedbackSynced = "StatusFeedbackSynced"
	ReasonAppliedManifestComplete    = "AppliedManifestComplete"
	MessageAppliedManifestComplete   = "Apply manifest complete"
	ReasonAppliedManifestFailed      = "AppliedManifestFailed"
	MessageAppliedManifestFailedFm   = "Failed to apply manifest: %s"
	ReasonResourceAvailable          = "ResourceAvailable"
	MessageResourceAvailable         = "Resource is available"
	ReasonResourceNotAvailable       = "ResourceNotAvailable"
	MessageResourceNotAvailable      = "Resource is not available"
	ReasonNoStatusFeedbackSynced     = "NoStatusFeedbackSynced"
	ReasonStatusFeedbackSynced       = "StatusFeedbackSynced"
	ReasonConditionRuleEvaluated     = "ConditionRuleEvaluated"

	// ManifestWorkReplicaSet conditions (hub controller); messages are "".
	CondPlacementVerified   = "PlacementVerified"
	CondPlacementRolledOut  = "PlacementRolledOut"
	CondManifestworkApplied = "ManifestworkApplied"

	ReasonAsExpected                 = "AsExpected"
	ReasonPlacementDecisionNotFound  = "PlacementDecisionNotFound"
	ReasonPlacementDecisionEmpty     = "PlacementDecisionEmpty"
	ReasonNotAsExpected              = "NotAsExpected"
	ReasonRolloutComplete            = "Complete"
	ReasonRolloutProgressing         = "Progressing"
	ReasonProcessing                 = "Processing"
	MessageFeatureGateDisabled       = "ManifestWorkReplicaSet feature gate disabled on hub" // acm.md "Proposal"; the console's text for the backend's FailedPrecondition
	MessageReferencedByCatalogFm     = "model %s is referenced by %s; remove those references first"
	LabelManifestWorkReplicaSetOwner = "work.open-cluster-management.io/manifestworkreplicaset"
	LabelPlacementName               = "work.open-cluster-management.io/placementname"
	// LabelFailApply on a ManagedCluster makes its work fail to apply
	// (acm.md item 11). A console-owned mock label, not a hub one.
	LabelFailApply = "ai-grid-mock/fail-apply"

	// Feedback rule names and the resource identifiers of the two manifests
	// the console's template carries: the model namespace and the
	// LLMInferenceService (acm.md 4, "model deployment ManifestWork").
	FeedbackReady       = "ready"
	FeedbackURL         = "url"
	FeedbackTypeString  = "String"
	manifestNamespace   = "namespaces"
	kindNamespace       = "Namespace"
	llmisvcGroup        = "serving.kserve.io"
	llmisvcVersion      = "v1alpha2"
	llmisvcResource     = "llminferenceservices"
	llmisvcKind         = "LLMInferenceService"
	manifestCount       = 2
	ruleBearingManifest = 1

	// The condition rules' messages are the template author's, that is the
	// console's (the research example writes "InferenceService rolling out").
	MessageRuleProgressing = "LLMInferenceService rolling out"
	MessageRuleDegraded    = "LLMInferenceService not ready"

	// workAvailableAfter is how long the agent takes to report resources
	// available after applying (acm.md item 9: t+2 s).
	workAvailableAfter = 2 * time.Second
	// generateNameAlphabet is what Kubernetes draws a generateName suffix from.
	generateNameAlphabet = "bcdfghjklmnpqrstvwxz2456789"
	generateNameLength   = 5
)

// MessageAppliedManifestFailedNoMatch is the apply error when the spoke lacks
// the KServe CRD (acm.md 4: "no matches for kind ...").
var MessageAppliedManifestFailedNoMatch = fmt.Sprintf(MessageAppliedManifestFailedFm, `no matches for kind "`+llmisvcKind+`" in version "`+llmisvcGroup+`/`+llmisvcVersion+`"`)

// rolloutState is sdk-go's ClusterRolloutStatus for one selected cluster
// (acm.md "Rollout counting").
type rolloutState int

const (
	rolloutToApply rolloutState = iota
	rolloutProgressing
	rolloutSucceeded
	rolloutFailed
	rolloutTimeOut
)

// work is one generated ManifestWork. Times are scenario time.
type work struct {
	cluster string
	name    string
	// startedAt is when the controller created or last updated the work.
	startedAt time.Time
	// agentStart is when the spoke agent first reported, nil while the
	// cluster is not Available (an unreachable agent reports nothing). It is
	// shifted forward by the length of every later disconnection, so the
	// spoke's lifecycle resumes where it stopped.
	agentStart *time.Time
	// frozenAt is set while the agent is disconnected after it reported: the
	// hub keeps the status as it was at that instant until the agent is back.
	frozenAt *time.Time
	// generation the work carries (bumped by an update of the template) and
	// the spec it applied: a work waiting its turn in a Progressive update
	// keeps serving the spec it was applied with.
	generation int64
	spec       *aigridv1.ModelSpec
	// failApply mirrors the cluster's `ai-grid-mock/fail-apply` label when
	// the work was applied.
	failApply bool
}

// workView is a work's derived status at one instant.
type workView struct {
	status    *aigridv1.ManifestWorkStatus
	state     rolloutState
	succeeded time.Time // when Progressing became False, for minSuccessTime
}

// newWorkSuffix draws a Kubernetes generateName suffix.
func newWorkSuffix() string {
	var b [generateNameLength]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("crypto/rand: %v", err))
	}
	for i := range b {
		b[i] = generateNameAlphabet[int(b[i])%len(generateNameAlphabet)]
	}
	return string(b[:])
}

// deriveWork is the agent's report at scenario time `now` for a work whose
// template carries the LLMInferenceService `in` (the spoke's lifecycle is the
// hub's, started when the agent applied the work): Applied at once, Available
// after workAvailableAfter, then the rule conditions and the `ready`/`url`
// feedback from the spoke object. Only the spoke agent writes a work's status
// (ocm:pkg/work/spoke), so a cluster whose agent never reported has an empty
// status: no conditions, no manifests. The rollout counts such a work, and
// one whose Applied is not True or whose Progressing is missing, as ToApply;
// sdk-go's determineRolloutStatus never times out ToApply (only Progressing
// and Failed reach TimeOut after progressDeadline), so a dead or unapplied
// cluster holds its Progressive slot indefinitely. `at` converts scenario
// time to wall time.
func deriveWork(w *work, in llmisvcInput, now time.Time, deadline time.Duration, at func(time.Time) time.Time) workView {
	st := &aigridv1.ManifestWorkStatus{ClusterName: w.cluster, WorkName: w.name, Generation: w.generation}
	view := workView{status: st, state: rolloutToApply}
	timedOut := deadline > 0 && !now.Before(w.startedAt.Add(deadline))
	if w.agentStart == nil || now.Before(*w.agentStart) {
		return view
	}
	if w.frozenAt != nil && w.frozenAt.Before(now) {
		now = *w.frozenAt // the agent is gone: the hub keeps its last report
	}
	start := *w.agentStart
	st.ObservedGeneration = w.generation
	nsManifest := &aigridv1.ManifestStatus{Resource: &aigridv1.ResourceIdentifier{Ordinal: 0, Version: "v1", Resource: manifestNamespace, Kind: kindNamespace, Name: in.namespace}}
	modelManifest := &aigridv1.ManifestStatus{Resource: &aigridv1.ResourceIdentifier{Ordinal: 1, Group: llmisvcGroup, Version: llmisvcVersion, Resource: llmisvcResource, Kind: llmisvcKind, Namespace: in.namespace, Name: in.name}}
	st.Manifests = []*aigridv1.ManifestStatus{nsManifest, modelManifest}
	// write stamps a condition with the work's generation, as the agent does.
	write := func(conds []*aigridv1.Condition, t time.Time, typ string, status aigridv1.ConditionStatus, reason, message string) []*aigridv1.Condition {
		conds = writeCondition(conds, at(t), typ, status, reason, message)
		condition(conds, typ).ObservedGeneration = w.generation
		return conds
	}
	nsManifest.Conditions = write(nil, start, CondWorkApplied, cTrue, ReasonAppliedManifestComplete, MessageAppliedManifestComplete)
	if w.failApply {
		st.Conditions = write(st.Conditions, start, CondWorkApplied, cFalse, ReasonAppliedManifestWorkFailed, MessageAppliedManifestWorkFailed)
		modelManifest.Conditions = write(nil, start, CondWorkApplied, cFalse, ReasonAppliedManifestFailed, MessageAppliedManifestFailedNoMatch)
	} else {
		st.Conditions = write(st.Conditions, start, CondWorkApplied, cTrue, ReasonAppliedManifestWorkComplete, MessageAppliedManifestWorkComplete)
		modelManifest.Conditions = write(nil, start, CondWorkApplied, cTrue, ReasonAppliedManifestComplete, MessageAppliedManifestComplete)
	}
	synced := start.Add(workAvailableAfter)
	if now.Before(synced) {
		// Between the manifest controller's Applied and the status controller's
		// first sync, Available and the rule conditions are simply absent
		// (acm.md item 9): the work is ToApply (no Progressing yet).
		return view
	}
	nsManifest.Conditions = write(nsManifest.Conditions, synced, CondWorkAvailable, cTrue, ReasonResourceAvailable, MessageResourceAvailable)
	nsManifest.Conditions = write(nsManifest.Conditions, synced, CondManifestStatusFeedbackSynced, cTrue, ReasonNoStatusFeedbackSynced, "")
	if w.failApply {
		// The object was never created. The status controller finds it
		// missing, sets Available=False and skips the feedback and the
		// condition rules for that manifest (ocm:availablestatus_controller.go),
		// so no Progressing or Degraded exists; the work stays ToApply
		// (Applied not True), which has no timeout.
		st.Conditions = write(st.Conditions, synced, CondWorkAvailable, cFalse, ReasonResourcesNotAvailable, fmt.Sprintf(MessageResourcesNotAvailableFm, 1, manifestCount))
		modelManifest.Conditions = write(modelManifest.Conditions, synced, CondWorkAvailable, cFalse, ReasonResourceNotAvailable, MessageResourceNotAvailable)
		return view
	}
	var progressing, degraded aigridv1.ConditionStatus
	var transition time.Time
	{
		st.Conditions = write(st.Conditions, synced, CondWorkAvailable, cTrue, ReasonResourcesAvailable, MessageResourcesAvailable)
		modelManifest.Conditions = write(modelManifest.Conditions, synced, CondWorkAvailable, cTrue, ReasonResourceAvailable, MessageResourceAvailable)
		modelManifest.Conditions = write(modelManifest.Conditions, synced, CondManifestStatusFeedbackSynced, cTrue, ReasonStatusFeedbackSynced, "")
		// The spoke object's lifecycle, as the feedback rules and the CEL
		// condition rules see it.
		spoke, readyAt := llmisvcStatus([]llmisvcGeneration{{in: in}}, now.Sub(start), func(d time.Duration) time.Time { return at(start.Add(d)) })
		ready := condition(spoke.GetConditions(), CondReady)
		if ready != nil {
			modelManifest.Feedback = append(modelManifest.Feedback, &aigridv1.FeedbackValue{Name: FeedbackReady, Type: FeedbackTypeString, Value: conditionStatusString(ready.GetStatus())})
		}
		if spoke.GetUrl() != "" {
			modelManifest.Feedback = append(modelManifest.Feedback, &aigridv1.FeedbackValue{Name: FeedbackURL, Type: FeedbackTypeString, Value: spoke.GetUrl()})
		}
		progressing, degraded, transition = cTrue, cFalse, synced
		switch {
		case ready.GetStatus() == cTrue: // Progressing rule: no Ready=True
			progressing, transition = cFalse, start.Add(readyAt)
		case isTerminalFailure(ready): // Degraded rule, see terminalReadyReasons
			degraded, transition = cTrue, start.Add(readyAt)
		}
		if transition.Before(synced) {
			transition = synced // a rule is first evaluated at the first sync
		}
	}
	modelManifest.Conditions = write(modelManifest.Conditions, synced, CondWorkProgressing, cTrue, ReasonConditionRuleEvaluated, MessageRuleProgressing)
	modelManifest.Conditions = write(modelManifest.Conditions, transition, CondWorkProgressing, progressing, ReasonConditionRuleEvaluated, MessageRuleProgressing)
	modelManifest.Conditions = write(modelManifest.Conditions, synced, CondWorkDegraded, cFalse, ReasonConditionRuleEvaluated, MessageRuleDegraded)
	modelManifest.Conditions = write(modelManifest.Conditions, transition, CondWorkDegraded, degraded, ReasonConditionRuleEvaluated, MessageRuleDegraded)
	// Work-level aggregation: one rule-bearing manifest, so its message is
	// copied verbatim (acm.md 4, condition strings table).
	st.Conditions = write(st.Conditions, synced, CondWorkProgressing, cTrue, ReasonConditionRulesAggregated, aggregatedMessage(MessageRuleProgressing, ruleBearingManifest))
	st.Conditions = write(st.Conditions, transition, CondWorkProgressing, progressing, ReasonConditionRulesAggregated, aggregatedMessage(MessageRuleProgressing, ruleBearingManifest))
	st.Conditions = write(st.Conditions, synced, CondWorkDegraded, cFalse, ReasonConditionRulesAggregated, aggregatedMessage(MessageRuleDegraded, ruleBearingManifest))
	st.Conditions = write(st.Conditions, transition, CondWorkDegraded, degraded, ReasonConditionRulesAggregated, aggregatedMessage(MessageRuleDegraded, ruleBearingManifest))

	switch {
	case progressing == cFalse:
		view.state, view.succeeded = rolloutSucceeded, transition
	case degraded == cTrue:
		view.state = rolloutFailed
	default:
		view.state = rolloutProgressing
	}
	if view.state != rolloutSucceeded && timedOut {
		view.state = rolloutTimeOut
	}
	return view
}

// aggregatedMessage is the work-level message of a rule-derived condition:
// the manifest's own message when exactly one manifest carries the condition,
// otherwise "Aggregated from <n> manifest conditions".
func aggregatedMessage(single string, n int) string {
	if n == 1 {
		return single
	}
	return fmt.Sprintf(MessageAggregatedFm, n)
}

// parseIntOrPercent reads a rollout count: an integer, or a percentage of
// total rounded up (intstr.GetScaledValueFromIntOrPercent with roundUp).
// Empty yields def.
func parseIntOrPercent(s string, total, def int) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return def, nil
	}
	if pct, ok := strings.CutSuffix(s, "%"); ok {
		p, err := strconv.Atoi(strings.TrimSpace(pct))
		if err != nil || p < 0 || p > 100 {
			return 0, fmt.Errorf("%q is not a percentage between 0%% and 100%%", s)
		}
		return int(math.Ceil(float64(total) * float64(p) / 100)), nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%q is not a non-negative integer or a percentage", s)
	}
	return n, nil
}

// parseRolloutDuration reads a Kubernetes duration such as `5m`; empty is zero
// (the CRD's `None` for progressDeadline, 0 for minSuccessTime).
func parseRolloutDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "None" {
		return 0, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil || d < 0 {
		return 0, fmt.Errorf("%q is not a duration such as 5m or 1h", s)
	}
	return d, nil
}

// rolloutParams are the parsed rollout strategy fields.
type rolloutParams struct {
	strategy         aigridv1.RolloutStrategy
	maxConcurrency   string
	maxFailures      string
	progressDeadline time.Duration
	minSuccessTime   time.Duration
}

// validateRollout parses the strategy fields; the messages are the console's
// wording for the CRD's IntOrString and duration validation.
func validateRollout(r *aigridv1.Rollout) (rolloutParams, error) {
	p := rolloutParams{strategy: r.GetStrategy(), maxConcurrency: r.GetMaxConcurrency(), maxFailures: r.GetMaxFailures()}
	if p.strategy == aigridv1.RolloutStrategy_ROLLOUT_STRATEGY_UNSPECIFIED {
		p.strategy = aigridv1.RolloutStrategy_ROLLOUT_STRATEGY_ALL
	}
	if _, ok := aigridv1.RolloutStrategy_name[int32(p.strategy)]; !ok {
		return p, fmt.Errorf("spec.rollout.strategy %d is not All, Progressive or ProgressivePerGroup", p.strategy)
	}
	if _, err := parseIntOrPercent(p.maxConcurrency, 1, 0); err != nil {
		return p, fmt.Errorf("spec.rollout.max_concurrency: %w", err)
	}
	if _, err := parseIntOrPercent(p.maxFailures, 1, 0); err != nil {
		return p, fmt.Errorf("spec.rollout.max_failures: %w", err)
	}
	var err error
	if p.progressDeadline, err = parseRolloutDuration(r.GetProgressDeadline()); err != nil {
		return p, fmt.Errorf("spec.rollout.progress_deadline: %w", err)
	}
	if p.minSuccessTime, err = parseRolloutDuration(r.GetMinSuccessTime()); err != nil {
		return p, fmt.Errorf("spec.rollout.min_success_time: %w", err)
	}
	return p, nil
}

// workNameFor builds a generated work's name from the MWRS name.
func workNameFor(mwrs, suffix string) string { return mwrs + "-" + suffix }

// sortWorks orders works by cluster name, the order the decisions use.
func sortWorks(works []*work) {
	sort.Slice(works, func(i, j int) bool { return works[i].cluster < works[j].cluster })
}
