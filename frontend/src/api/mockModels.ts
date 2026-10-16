import type { Capabilities, ClusterCondition, GridCluster, Model, ModelPlacement, ModelRollout, PlacementSpec, RolloutSpec, WorkStatus } from './types';

/**
 * Model seeds for the browser mock. They mirror mock/fixtures/models.json
 * model for model (names, namespaces, specs, labels, annotations, placements
 * and rollout strategies; a test keeps the two in step) in the state the fake
 * backend derives for them once their lifecycle has settled: the condition
 * types, reasons and messages are the ones KServe, the ACM placement
 * controller and the work agent write (mock/research/models-maas.md 2.1,
 * mock/research/acm.md 3 and 4), transcribed from bff/internal/fakebackend.
 */

export const PRESETS_NAMESPACE = 'redhat-ods-applications';
export const PRESET_TEMPLATE = 'v3-6-0-kserve-config-llm-template';
export const PRESET_SCHEDULER = 'v3-6-0-kserve-config-llm-scheduler';
export const PRESET_ROUTER_ROUTE = 'v3-6-0-kserve-config-llm-router-route';
/** The installed presets (mock/fixtures/presets.json); an unknown baseRef fails with ConfigNotFound. */
export const INSTALLED_PRESETS = [
  PRESET_TEMPLATE,
  'v3-6-0-kserve-config-llm-template-cpu',
  PRESET_SCHEDULER,
  PRESET_ROUTER_ROUTE,
  'v3-6-0-kserve-config-llm-decode-template',
  'v3-6-0-kserve-config-llm-prefill-template',
  'v3-6-0-kserve-config-llm-tokenizer',
  'v3-6-0-kserve-config-llm-tracing',
  'v3-6-0-kserve-config-llm-worker-data-parallel',
];

export const DEFAULT_GATEWAY = { name: 'openshift-ai-inference', namespace: 'openshift-ingress' };
export const MODELS_NAMESPACE = 'ai-grid-models';
export const MOCK_CAPABILITIES: Capabilities = { manifestWorkReplicaSetEnabled: true, observabilityInstalled: false, acmVersion: '2.17.3' };
/** The backend's FailedPrecondition text when a placed model is created with the gate off (mock/research/acm.md). */
export const GATE_DISABLED_MESSAGE = 'ManifestWorkReplicaSet feature gate disabled on hub';

const at = (iso: string) => iso;

const cond = (type: string, status: ClusterCondition['status'], at: string, reason?: string, message?: string): ClusterCondition => ({
  type,
  status,
  ...(reason ? { reason } : {}),
  ...(message ? { message } : {}),
  lastTransitionTime: at,
});

/** The nine conditions of a Ready LLMInferenceService with a managed route and a scheduler, Knative-sorted by type. */
const readyConditions = (created: string): ClusterCondition[] => {
  const t = (s: number) => new Date(new Date(created).getTime() + s * 1000).toISOString().replace('.000Z', 'Z');
  return [
    cond('GatewaysReady', 'True', t(5)),
    cond('HTTPRoutesReady', 'True', t(15)),
    cond('InferencePoolReady', 'True', t(15)),
    cond('MainWorkloadReady', 'True', t(45)),
    cond('PresetsCombined', 'True', t(5)),
    cond('Ready', 'True', t(45)),
    cond('RouterReady', 'True', t(15)),
    cond('SchedulerWorkloadReady', 'True', t(15)),
    cond('WorkloadsReady', 'True', t(45)),
  ];
};

const hubAddresses = (namespace: string, name: string, modelName: string) => {
  const publishers = `publishers/${namespace}/models/${modelName}`;
  const external = `https://${DEFAULT_GATEWAY.name}.apps.hub.example.com`;
  const internal = `https://${DEFAULT_GATEWAY.name}-${DEFAULT_GATEWAY.name}.${DEFAULT_GATEWAY.namespace}.svc.cluster.local`;
  return [external, internal].flatMap((host, i) => [
    { name: i === 0 ? 'gateway-external-model-routing' : 'gateway-internal-model-routing', url: `${host}/`, models: [publishers] },
    { name: i === 0 ? 'gateway-external' : 'gateway-internal', url: `${host}/${namespace}/${name}`, models: [publishers, modelName] },
    { name: i === 0 ? 'gateway-external' : 'gateway-internal', url: `${host}/${publishers}`, models: [publishers, modelName] },
  ]);
};

const appliedConfigs = (baseRefs: string[]) => [
  { name: PRESET_SCHEDULER, namespace: PRESETS_NAMESPACE, source: 'Preset' },
  { name: PRESET_ROUTER_ROUTE, namespace: PRESETS_NAMESPACE, source: 'Preset' },
  { name: PRESET_TEMPLATE, namespace: PRESETS_NAMESPACE, source: 'Preset' },
  ...baseRefs.map((name) => ({ name, namespace: PRESETS_NAMESPACE, source: 'UserRef' })),
];

/** A completed work on one site: Applied, Available, Progressing False, ready "True" and the spoke URL. */
const completeWork = (cluster: string, workName: string, namespace: string, name: string, applied: string): WorkStatus => {
  const t = (s: number) => new Date(new Date(applied).getTime() + s * 1000).toISOString().replace('.000Z', 'Z');
  return {
    cluster,
    workName,
    applied: 'True',
    available: 'True',
    progressing: 'False',
    degraded: 'False',
    feedback: { ready: 'True', url: `https://${DEFAULT_GATEWAY.name}.apps.${cluster}.example.com/${namespace}/${name}` },
    conditions: [
      cond('Applied', 'True', t(0), 'AppliedManifestWorkComplete', 'Apply manifest work complete'),
      cond('Available', 'True', t(2), 'ResourcesAvailable', 'All resources are available'),
      cond('Progressing', 'False', t(45), 'ConditionRulesAggregated', 'LLMInferenceService rolling out'),
      cond('Degraded', 'False', t(2), 'ConditionRulesAggregated', 'LLMInferenceService not ready'),
    ],
    generation: 1,
    observedGeneration: 1,
  };
};

/** A work whose spoke object is still starting: Progressing True, ready "False", no URL yet. */
const progressingWork = (cluster: string, workName: string, applied: string): WorkStatus => {
  const t = (s: number) => new Date(new Date(applied).getTime() + s * 1000).toISOString().replace('.000Z', 'Z');
  return {
    cluster,
    workName,
    applied: 'True',
    available: 'True',
    progressing: 'True',
    degraded: 'False',
    feedback: { ready: 'False' },
    conditions: [
      cond('Applied', 'True', t(0), 'AppliedManifestWorkComplete', 'Apply manifest work complete'),
      cond('Available', 'True', t(2), 'ResourcesAvailable', 'All resources are available'),
      cond('Progressing', 'True', t(2), 'ConditionRulesAggregated', 'LLMInferenceService rolling out'),
      cond('Degraded', 'False', t(2), 'ConditionRulesAggregated', 'LLMInferenceService not ready'),
    ],
    generation: 1,
    observedGeneration: 1,
  };
};

const satisfiedPlacement = (spec: PlacementSpec, selected: string[], at: string): ModelPlacement => ({
  ...spec,
  selectedClusters: selected,
  satisfied: selected.length > 0,
  reason: selected.length > 0 ? 'AllDecisionsScheduled' : 'NoManagedClusterMatched',
  message: selected.length > 0 ? 'All cluster decisions scheduled' : 'No ManagedCluster matches any of the cluster predicate',
  conditions: [
    cond('PlacementMisconfigured', 'False', at, 'Succeedconfigured', 'Placement configurations check pass'),
    selected.length > 0
      ? cond('PlacementSatisfied', 'True', at, 'AllDecisionsScheduled', 'All cluster decisions scheduled')
      : cond('PlacementSatisfied', 'False', at, 'NoManagedClusterMatched', 'No ManagedCluster matches any of the cluster predicate'),
  ],
});

/** The MWRS status derived from its works by the rules in mock/research/acm.md 4. */
export const rolloutFromWorks = (spec: RolloutSpec, works: WorkStatus[], selected: number, at: string): ModelRollout => {
  const count = (f: (w: WorkStatus) => boolean) => works.filter(f).length;
  const summary = {
    total: works.length,
    applied: count((w) => w.applied === 'True'),
    available: count((w) => w.available === 'True'),
    progressing: count((w) => w.progressing === 'True'),
    degraded: count((w) => w.degraded === 'True'),
    updated: works.length,
  };
  const rolledOut = selected > 0 && works.length === selected && works.every((w) => w.applied === 'True' && w.progressing === 'False');
  let reason: string;
  if (summary.total === 0) {
    reason = selected === 0 ? 'PlacementDecisionEmpty' : 'NotAsExpected';
  } else if (summary.available === summary.total && summary.progressing === 0 && summary.degraded === 0) {
    reason = 'AsExpected';
  } else if (summary.progressing > 0 && summary.degraded === 0) {
    reason = 'Processing';
  } else {
    reason = 'NotAsExpected';
  }
  return {
    ...spec,
    strategy: spec.strategy ?? 'All',
    summary,
    rolledOut,
    applied: reason === 'AsExpected',
    reason,
    conditions: [
      selected > 0 ? cond('PlacementVerified', 'True', at, 'AsExpected') : cond('PlacementVerified', 'False', at, 'PlacementDecisionEmpty'),
      rolledOut ? cond('PlacementRolledOut', 'True', at, 'Complete') : cond('PlacementRolledOut', 'False', at, 'Progressing'),
      cond('ManifestworkApplied', reason === 'AsExpected' ? 'True' : 'False', at, reason),
    ],
    works,
  };
};

/** The phase derivation for a placed model, as the fake backend does it. */
export const placedPhase = (rollout: ModelRollout): Pick<Model, 'phase' | 'reason'> => {
  const broken = rollout.summary.degraded > 0 || rollout.works.some((w) => w.applied === 'False');
  if (rollout.rolledOut && rollout.applied) {
    return { phase: 'ready', reason: 'Complete' };
  }
  if (rollout.reason === 'NotAsExpected' && broken) {
    return { phase: 'failed', reason: 'NotAsExpected' };
  }
  const verified = rollout.conditions.find((c) => c.type === 'PlacementVerified');
  if (verified?.status === 'False') {
    return { phase: 'pending', reason: verified.reason };
  }
  if (rollout.applied) {
    return { phase: 'pending', reason: 'Progressing' };
  }
  return { phase: 'pending', reason: rollout.reason };
};

type Seed = Omit<Model, 'env' | 'gateways' | 'addresses' | 'conditions' | 'appliedConfigs' | 'labels' | 'annotations' | 'requests' | 'limits'> &
  Partial<Pick<Model, 'env' | 'gateways' | 'addresses' | 'conditions' | 'appliedConfigs' | 'labels' | 'annotations' | 'requests' | 'limits'>>;

const seed = (s: Seed): Model => ({
  env: [],
  gateways: [DEFAULT_GATEWAY],
  addresses: [],
  conditions: [],
  appliedConfigs: [],
  labels: {},
  annotations: {},
  requests: {},
  limits: {},
  ...s,
});

const annotations = (displayName: string, description: string) => ({ 'openshift.io/display-name': displayName, 'openshift.io/description': description });

export const seedModels = (): Model[] => {
  const tinyCreated = at('2026-10-01T10:00:00Z');
  const graniteCreated = at('2026-10-10T08:00:00Z');
  const mistralCreated = at('2026-10-15T12:00:00Z');
  const granitePlacement: PlacementSpec = { clusterSets: ['global'], matchLabels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true' } };
  const graniteWorks = [completeWork('site-paris-1', 'model-granite-8b-instruct-x7k2p', MODELS_NAMESPACE, 'granite-8b-instruct', graniteCreated)];
  const graniteRollout = rolloutFromWorks({ strategy: 'All', progressDeadline: '15m' }, graniteWorks, 1, graniteCreated);
  const mistralPlacement: PlacementSpec = {
    clusterSets: ['global'],
    matchLabels: { vendor: 'OpenShift' },
    matchExpressions: [{ key: 'local-cluster', operator: 'NotIn', values: ['true'] }],
  };
  const mistralWorks = [progressingWork('site-frankfurt-1', 'model-mistral-7b-instruct-m4q8z', mistralCreated)];
  const mistralRollout = rolloutFromWorks(
    { strategy: 'Progressive', maxConcurrency: '1', maxFailures: '0', progressDeadline: '15m', minSuccessTime: '30s' },
    mistralWorks,
    2,
    mistralCreated,
  );
  const codePlacement: PlacementSpec = {
    clusterSets: ['global'],
    matchLabels: { 'ai-grid/enabled': 'true' },
    matchExpressions: [{ key: 'ai-grid/region', operator: 'In', values: ['asia-east'] }],
  };
  const codeRollout = rolloutFromWorks({ strategy: 'All' }, [], 0, '2026-10-14T09:00:00Z');
  const configNotFound = 'LLMInferenceServiceConfig "v3-6-0-kserve-config-llm-template-tpu" not found in namespaces [ai-grid-models redhat-ods-applications]';
  return [
    seed({
      name: 'tiny-llm',
      namespace: MODELS_NAMESPACE,
      displayName: 'Tiny LLM (CPU)',
      description: 'Small CPU-only model served on the hub itself for smoke tests.',
      modelUri: 'hf://example-org/tiny-llm',
      modelName: 'example-org/tiny-llm',
      replicas: 1,
      baseRefs: ['v3-6-0-kserve-config-llm-template-cpu'],
      requests: { cpu: '4', memory: '16Gi' },
      limits: { cpu: '8', memory: '24Gi' },
      env: [{ name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' }],
      phase: 'ready',
      url: `https://${DEFAULT_GATEWAY.name}.apps.hub.example.com/${MODELS_NAMESPACE}/tiny-llm`,
      addresses: hubAddresses(MODELS_NAMESPACE, 'tiny-llm', 'example-org/tiny-llm'),
      conditions: readyConditions(tinyCreated),
      appliedConfigs: appliedConfigs(['v3-6-0-kserve-config-llm-template-cpu']),
      labels: { 'ai-grid/family': 'tiny' },
      annotations: annotations('Tiny LLM (CPU)', 'Small CPU-only model served on the hub itself for smoke tests.'),
      resourceVersion: '48700101',
      generation: 1,
      creationTimestamp: tinyCreated,
    }),
    seed({
      name: 'granite-8b-instruct',
      namespace: MODELS_NAMESPACE,
      displayName: 'Granite 8B Instruct',
      description: 'Served on every enrolled and provisioned site.',
      modelUri: 'hf://example-org/granite-8b-instruct',
      modelName: 'example-org/granite-8b-instruct',
      runtimeImage: 'quay.io/example/vllm-cuda:v0.11.0',
      replicas: 1,
      baseRefs: [PRESET_TEMPLATE],
      requests: { cpu: '8', memory: '32Gi', 'nvidia.com/gpu': '1' },
      limits: { 'nvidia.com/gpu': '1' },
      ...placedPhase(graniteRollout),
      placement: satisfiedPlacement(granitePlacement, ['site-paris-1'], graniteCreated),
      rollout: graniteRollout,
      labels: { 'ai-grid/family': 'granite' },
      annotations: annotations('Granite 8B Instruct', 'Served on every enrolled and provisioned site.'),
      resourceVersion: '48760230',
      generation: 1,
      creationTimestamp: graniteCreated,
    }),
    seed({
      name: 'mistral-7b-instruct',
      namespace: MODELS_NAMESPACE,
      displayName: 'Mistral 7B Instruct',
      description: 'Rolled out to every OpenShift spoke one site at a time.',
      modelUri: 'oci://registry.example.com/models/mistral-7b-instruct:v0.3',
      modelName: 'example-org/mistral-7b-instruct',
      runtimeImage: 'quay.io/example/vllm-cuda:v0.11.0',
      replicas: 2,
      baseRefs: [PRESET_TEMPLATE],
      requests: { cpu: '8', memory: '32Gi', 'nvidia.com/gpu': '1' },
      limits: { 'nvidia.com/gpu': '1' },
      ...placedPhase(mistralRollout),
      placement: satisfiedPlacement(mistralPlacement, ['site-frankfurt-1', 'site-paris-1'], mistralCreated),
      rollout: mistralRollout,
      labels: { 'ai-grid/family': 'mistral' },
      annotations: annotations('Mistral 7B Instruct', 'Rolled out to every OpenShift spoke one site at a time.'),
      resourceVersion: '48812900',
      generation: 1,
      creationTimestamp: mistralCreated,
    }),
    seed({
      name: 'llama-3-70b',
      namespace: MODELS_NAMESPACE,
      displayName: 'Llama 3 70B',
      description: 'References a TPU preset this hub does not have.',
      modelUri: 'hf://example-org/llama-3-70b',
      modelName: 'example-org/llama-3-70b',
      replicas: 1,
      baseRefs: ['v3-6-0-kserve-config-llm-template-tpu'],
      requests: { cpu: '16', memory: '160Gi', 'nvidia.com/gpu': '4' },
      limits: { 'nvidia.com/gpu': '4' },
      phase: 'failed',
      reason: 'ConfigNotFound',
      message: configNotFound,
      conditions: [
        cond('PresetsCombined', 'False', '2026-10-12T16:30:05Z', 'ConfigNotFound', configNotFound),
        cond('Ready', 'False', '2026-10-12T16:30:05Z', 'ConfigNotFound', configNotFound),
      ],
      labels: { 'ai-grid/family': 'llama' },
      annotations: annotations('Llama 3 70B', 'References a TPU preset this hub does not have.'),
      resourceVersion: '48790412',
      generation: 1,
      creationTimestamp: '2026-10-12T16:30:00Z',
    }),
    seed({
      name: 'codellama-13b',
      namespace: MODELS_NAMESPACE,
      displayName: 'Code Llama 13B',
      description: 'Placed in a region with no enrolled site yet.',
      modelUri: 's3://models-example/codellama-13b/',
      modelName: 'example-org/codellama-13b',
      runtimeImage: 'quay.io/example/vllm-cuda:v0.11.0',
      replicas: 1,
      baseRefs: [PRESET_TEMPLATE],
      requests: { cpu: '8', memory: '48Gi', 'nvidia.com/gpu': '2' },
      limits: { 'nvidia.com/gpu': '2' },
      ...placedPhase(codeRollout),
      placement: satisfiedPlacement(codePlacement, [], '2026-10-14T09:00:00Z'),
      rollout: codeRollout,
      labels: { 'ai-grid/family': 'codellama' },
      annotations: annotations('Code Llama 13B', 'Placed in a region with no enrolled site yet.'),
      resourceVersion: '48801577',
      generation: 1,
      creationTimestamp: '2026-10-14T09:00:00Z',
    }),
  ];
};

/** apimachinery's IsDNS1123Label, as the API server applies it to a namespace name. */
export const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
export const dns1123LabelMessage = (field: string, value: string) =>
  `${field}: Invalid value: ${JSON.stringify(value)}: a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')`;
/** apimachinery's IsDNS1123Subdomain, as the API server applies it to a custom resource's metadata.name (253 characters). */
export const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
export const dns1123SubdomainMessage = (field: string, value: string) =>
  `${field}: Invalid value: ${JSON.stringify(value)}: a lowercase RFC 1123 subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')`;

export const URI_SCHEMES = ['hf://', 's3://', 'pvc://', 'oci://'];

/** One In/NotIn/Exists/DoesNotExist requirement with Kubernetes semantics (NotIn and DoesNotExist match an absent key). */
const matchRequirement = (values: Record<string, string>, key: string, operator: string, wanted: string[] = []): boolean => {
  const present = key in values;
  switch (operator) {
    case 'In':
      return present && wanted.includes(values[key]);
    case 'NotIn':
      return !present || !wanted.includes(values[key]);
    case 'Exists':
      return present;
    case 'DoesNotExist':
      return !present;
    default:
      return false;
  }
};

/**
 * The placement controller's decision over the mock clusters: the predicate
 * over the labels, a cluster with an untolerated hub taint (anything not
 * Ready) or being detached is dropped, name order, capped at numberOfClusters.
 */
export const selectClusters = (spec: PlacementSpec, clusters: GridCluster[]): string[] => {
  const tolerates = (c: GridCluster) =>
    c.status === 'ready' || (spec.tolerations ?? []).some((t) => (c.status === 'unknown' && t.key.endsWith('/unreachable')) || (c.status === 'offline' && t.key.endsWith('/unavailable')));
  return clusters
    .filter((c) => c.status !== 'detaching' && tolerates(c))
    .filter((c) => Object.entries(spec.matchLabels ?? {}).every(([k, v]) => c.labels[k] === v))
    .filter((c) => (spec.matchExpressions ?? []).every((e) => matchRequirement(c.labels, e.key, e.operator, e.values)))
    .map((c) => c.name)
    .sort()
    .slice(0, spec.numberOfClusters ?? undefined);
};

/** The Placement status for a fresh decision. */
export const placementFor = (spec: PlacementSpec, selected: string[], at: string): ModelPlacement => satisfiedPlacement(spec, selected, at);
