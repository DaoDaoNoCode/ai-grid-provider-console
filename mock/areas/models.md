# Models (LLMInferenceService, Placement, ManifestWorkReplicaSet)

What the fake backend and the BFF implement for this area, where they deviate from the
research, which texts are invented, and what remains. The fixture data is described in
`mock/fixtures/README.md`, the HTTP contract in `docs/plan/bff-api.md`, the proto in
`mock/proto/README.md`. The research reports cited here (`mock/research/`) are background
reading.

Implemented. Fake (`bff/internal/fakebackend/{models.go,kserve.go,placement.go,work.go}`): a
store of models whose desired state is a KServe `LLMInferenceService` spec, optionally with an
ACM `Placement` and a `ManifestWorkReplicaSet` (both `model-<name>` in the model's namespace,
labelled `ai-grid/model=<name>`); the store keeps only what the controllers would have written
(when a model was created, when each generated work was applied) and derives everything else
on every read from the clock and the current clusters.
`CreateModel` admits like the API server and the KServe webhook (`mock/research/models-maas.md`
2.1, plus the CRD's CEL texts read from the hub): a DNS-1123 subdomain name and a DNS-1123
label namespace with apimachinery's messages, `spec.model.uri` with a known scheme, the four
`scaling` rules verbatim ("replicas and scaling are mutually exclusive; use scaling for
autoscaled deployments or replicas for static deployments", "either wva or keda must be
specified when scaling is configured", "at least one trigger is required when using direct
KEDA scaling", "minReplicas cannot exceed maxReplicas"), the Placement operators and cluster
sets, the rollout durations and percentages; `AlreadyExists` with the API server's message; and,
before writing an MWRS, `FailedPrecondition` "ManifestWorkReplicaSet feature gate disabled on
hub" when `settings.json` turns the gate off. The object comes back with no conditions. Then
the lifecycle of 8.2 replays on the scenario clock, each write stamped at the time it
happened so `lastTransitionTime` moves only on a status change: T1 (5 s) `PresetsCombined`,
`GatewaysReady`, `HTTPRoutesReady=False/WaitingForGateway` ("The following HTTPRoutes exist
but no Gateway controller has accepted them yet: [<ns>/<name>-kserve-route]", the reason
KServe's router reports for a managed route; `HTTPRouteNotObserved` "The managed HTTPRoute
has not been observed yet" is only reported for an inline route spec, which the console does
not write) and `appliedConfigs` (the implicit scheduler, router-route and template presets,
then the `baseRefs` as `UserRef`); T2 (15 s) the route, pool and scheduler ready,
`MainWorkloadReady=False/Progressing` with an empty message, `workloads` (`<name>-kserve`,
`<name>-kserve-router-scheduler`, the `<name>-kserve-workload-svc` Service); T2b (20 s)
`MinimumReplicasUnavailable` "Deployment does not have minimum availability."; T3 (45 s)
everything True, `url`, the six addresses (external and internal root, path and publishers
forms with their `models[]`), `workloads.primary.readyReplicas`. The roll-ups copy the first
failing dependent's reason and message as Knative does, so `Ready` reads
False/`WaitingForGateway`, then `Progressing`, then `MinimumReplicasUnavailable` while a
healthy model starts (transient reasons, not failures).
Failure modes: an unknown `baseRef` stops at T1 with `ConfigNotFound` and KServe's exact
message (`LLMInferenceServiceConfig "<name>" not found in namespaces [<ns> <apps-ns>]`); an
image or model name containing `oom` or `fail` stays at `MinimumReplicasUnavailable` and
turns into `ProgressDeadlineExceeded` with the Deployment's message after the default
600 s progress deadline; a Gateway outside `openshift-ingress/{openshift-ai-inference,
maas-default-gateway}` gives `GatewaysNotReady` ("The following Gateways are not ready:
[<ns>/<name>]") and `HTTPRoutesReady=False/WaitingForGateway`. A spec change bumps the
generation and the Deployment rolls out again from `Progressing`.
Placement decisions are recomputed from the clusters on every read (`mock/research/acm.md` 3,
items 6 and 7): the sets bound into the namespace (`global` = every cluster, `default` = the
`clusterset=default` label; `models.json` can unbind a namespace), the predicate (AND of
`matchLabels`, `matchExpressions` with Kubernetes `In|NotIn|Exists|DoesNotExist` semantics
and claim expressions), `NoSelect` taints dropped unless tolerated (key, value for `Equal`,
effect, `tolerationSeconds` counted from `timeAdded`), terminating clusters never selected,
cluster-name order, `numberOfClusters` cap, and `PlacementSatisfied` with the exact reasons
and messages (`AllDecisionsScheduled`, `NotAllDecisionsScheduled` "<n> cluster decisions
unscheduled", `NoManagedClusterMatched`, `NoManagedClusterSetBindings`, `NoIntersection`,
`AllManagedClusterSetsEmpty`) and `PlacementMisconfigured=False/Succeedconfigured` always.
The MWRS (`mock/research/acm.md` 4, items 8-13): one work per selected cluster named
`model-<name>-<5 chars from the generateName alphabet>` (random, like the API server's
`generateName`; tests inject a deterministic one with `SetWorkSuffixGenerator`);
`All` applies every cluster at once, `Progressive` (and `ProgressivePerGroup`, one decision
group) fills `maxConcurrency` slots in
cluster-name order, a slot held while the work is to apply, progressing or failed and for
`minSuccessTime` after it succeeded; a failed cluster counts towards `maxFailures` at once and
a progressing or failed one past `progressDeadline` times out, frees its slot and counts too,
after which nothing more is applied (sdk-go `progressivePerCluster`); a `ToApply` cluster (no
work yet, or a work whose `Applied` is not True or whose `Progressing` is missing) never
times out, so it holds its slot indefinitely and the rollout stalls on it, as on the hub (a
dead cluster is a Placement decision to make, not a rollout-engine one); the fake computes the
exact instant a slot frees so timing does not depend on polling. Only the spoke agent writes
a work's status, so a cluster that is not Available has a work with an empty status (no
conditions, no manifests), counted `ToApply` for as long as the agent is silent. From the
moment the agent reports: `Applied=True/AppliedManifestWorkComplete` at once, `Available`
absent until the status controller's first sync 2 s later, then `True/ResourcesAvailable`;
two manifests (the namespace and the LLMInferenceService)
with `Applied`, `Available`, `StatusFeedbackSynced` (`NoStatusFeedbackSynced` for the
namespace); the template's CEL rules evaluated against the spoke object's own lifecycle,
`Progressing=True` until its `Ready` is True and `Degraded=True` when `Ready` is False with
a terminal reason, with reason `ConditionRuleEvaluated` per manifest and
`ConditionRulesAggregated` on the work (the single rule-bearing manifest's message copied;
"Aggregated from <n> manifest conditions" otherwise); feedback `ready` ("False" then "True")
and `url`; every condition stamped with the work's `observedGeneration`. A cluster labelled
`ai-grid-mock/fail-apply=true` gets `Applied=False/AppliedManifestWorkFailed`, the manifest
`AppliedManifestFailed` "Failed to apply manifest: no matches for kind ..." and
`Available=False/ResourcesNotAvailable`; the status controller skips the feedback and the
condition rules of a manifest it cannot find, so no `Progressing` or `Degraded` exists and
the cluster stays `ToApply`, holding its slot without a timeout. The summary counts works per
condition and `updated` per generation;
`PlacementVerified` (`AsExpected` / `PlacementDecisionEmpty`), `PlacementRolledOut`
(`Complete` only when every selected cluster's work is `Applied=True` and `Progressing=False`
at the current generation, else `Progressing`) and `ManifestworkApplied` (`AsExpected`,
`Processing`, `NotAsExpected`, `PlacementDecisionEmpty`) follow the controller's rules. A
template change re-applies the works at the new generation; a cluster leaving the decision
loses its work; `DeleteModel` removes the model at once (the console's MWRS uses the CRD
default cascade `Background`: the finalize reconciler deletes the works and drops the
finalizer in one pass, so the MWRS is gone immediately and the works drain in the cluster
namespaces out of sight; only `Foreground` would keep it listed), and answers
`FailedPrecondition` through a `referencedBy` hook that the catalog and subscriptions area will
wire up (nothing references a model today). `GetHubCapabilities` answers
from `settings.json`. Mutations are gated by the provider-admin rule; every RPC needs
`authorization`; `ListModels` evaluates `this.metadata.namespace == "x"` and
`this.metadata.labels["k"] == "v"` joined with `&&`.
Deviations, documented in the code: the Degraded rule in the console's template fires only
on terminal `Ready=False` reasons (`ConfigNotFound`, `GatewaysNotReady`,
`ProgressDeadlineExceeded`), not on the transient ones KServe reports while starting, or
every rollout would read degraded for its first 45 s (the rule text is in `kserve.go`, the
template's contract); the derived phase of a placed model reads `NotAsExpected` without a
degraded or unapplied work as PENDING, because OCM reports `NotAsExpected` for a work whose
`Available` is simply not True yet; MWRS and Placement condition times are the time the fake
noticed a change, at most one poll
late (the real controller is event-driven with requeues), while every LLMInferenceService
and ManifestWork time is exact; the `apierror` name marker (`ReconcileSingleNodeWorkloadError`)
is deferred: its message is the free-form `err.Error()` of the failed Deployment write, so
any plausible API-server error would do. The hub and source checks of the Models-area review
(the CRD texts, the route messages, the scheduler Deployment name, the empty status of an
unreported work, the absent `Available` before the first sync, the rollout timeout rules and
the Background delete) are recorded in `mock/research/models-maas.md` 2.1/8.2/10 and
`mock/research/acm.md` 4 and items 9, 11, 13 of its proposal, so the research, this page and the
fake agree.
BFF: `GET /api/v1/models?namespace=&label=`, `GET/PATCH/DELETE /api/v1/models/{namespace}/{name}`,
`POST /api/v1/models` (201 + Location) and `GET /api/v1/capabilities` (501 against today's
backend), with the JSON shape in `docs/plan/bff-api.md`: the POC's `ManagedModel` without
its inventions, plus `placement` (selector, selected clusters, `PlacementSatisfied`) and
`rollout` (strategy, summary, per-site works with their condition statuses and the `ready`
and `url` feedback); PATCH is a locked read-modify-write with the present fields as the mask.
UI: not built yet; main has no Models page. See `docs/plan/bff-api.md` for the HTTP contract.
Remaining here: multi-node specs, `ProgressivePerGroup` with several decision groups, the
`apierror` failure mode, `status.router` in the proto, and the catalog reference check once
the catalog and subscriptions area exists.
Backend ask: the `Models` service and `Model` message as drafted in
`mock/proto/ai_grid/v1/model*.proto`, with the phase derived server-side; `AiGrid/GetHubCapabilities`;
the ManifestWorkReplicaSet feature gate on the hub (`mock/research/acm.md` open question 1).
