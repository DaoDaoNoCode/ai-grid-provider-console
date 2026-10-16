// Response shapes of the BFF. Keep in sync with docs/plan/bff-api.md.

export type User = {
  username: string;
  email?: string;
  groups: string[];
  /** UI hint only; the backend enforces authorization. */
  isProviderAdmin: boolean;
};

export type ConsoleConfig = {
  gridEndpoint: string;
  mapTileUrl: string;
  billingUrl: string;
  version: string;
};

/**
 * Lifecycle state the backend derives from the ManagedCluster conditions, in
 * the ACM console's words. Absent when the backend reports no status (the
 * shipped backend today).
 */
export type ClusterStatus =
  | 'ready'
  | 'offline'
  | 'unknown'
  | 'pendingimport'
  | 'importing'
  | 'importfailed'
  | 'detaching'
  | 'notaccepted';

export type ClusterCondition = {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  /** Absent when the hub recorded no transition time; never the epoch. */
  lastTransitionTime?: string;
};

export type GridCluster = {
  name: string;
  aiGridEnabled: boolean;
  provisioned: boolean;
  hubAcceptsClient: boolean;
  location?: string;
  site?: string;
  region?: string;
  openshiftVersion?: string;
  status?: ClusterStatus;
  statusMessage?: string;
  consoleUrl?: string;
  kubernetesVersion?: string;
  platform?: string;
  product?: string;
  gpuCapacity: number;
  siteName?: string;
  latitude?: number;
  longitude?: number;
  /** Add-on name to available | unhealthy | unreachable. */
  addons: Record<string, string>;
  conditions: ClusterCondition[];
  resourceVersion?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
};

/**
 * Body of PATCH /api/v1/clusters/{name}. Absent fields are left alone, an
 * empty string removes a label or annotation, null removes a coordinate.
 */
export type ClusterPatch = {
  aiGridEnabled?: boolean;
  provisioned?: boolean;
  location?: string;
  site?: string;
  region?: string;
  siteName?: string;
  latitude?: number | null;
  longitude?: number | null;
};

/** One organization domain with Keycloak's metadata. */
export type TenantDomain = {
  name: string;
  verified: boolean;
  identityProviderAlias?: string;
  autoRedirect: boolean;
};

/** A Keycloak Organization in the AI Grid realm, as the BFF exposes it. */
export type Tenant = {
  id: string;
  name: string;
  /** URL-safe handle, defaults to the name on create, immutable afterwards. */
  alias: string;
  enabled: boolean;
  description: string;
  /** Names of domainDetails, in the same order. */
  domains: string[];
  domainDetails: TenantDomain[];
  attributes: Record<string, string>;
};

/** Query of GET /api/v1/tenants. */
export type ListTenantsParams = {
  offset?: number;
  limit?: number;
  /** Case-insensitive contains on the name or a domain (Keycloak's `search`). */
  search?: string;
};

/** `meta` of a paged list response. */
export type ListMeta = {
  size: number;
  total: number;
  offset: number;
  limit?: number;
};

export type TenantPage = {
  items: Tenant[];
  meta: ListMeta;
};

/** Body of POST /api/v1/tenants. `enabled` defaults to true, `alias` to the name. */
export type TenantCreate = {
  name: string;
  alias?: string;
  description?: string;
  enabled?: boolean;
  domains?: string[];
  attributes?: Record<string, string>;
};

/**
 * Body of PATCH /api/v1/tenants/{id}. Absent fields are left alone; a present
 * field replaces the stored one as a whole. `alias` may be sent but must
 * equal the stored alias (Keycloak: "Cannot change the alias").
 */
export type TenantPatch = {
  name?: string;
  alias?: string;
  description?: string;
  enabled?: boolean;
  domains?: string[];
  attributes?: Record<string, string>;
};

/** Lifecycle summary the backend derives for a model (see docs/plan/bff-api.md). */
export type ModelPhase = 'pending' | 'ready' | 'failed';

export type EnvVar = { name: string; value: string };

/** One `spec.scaling.keda.triggers[]` entry. */
export type KedaTrigger = { type: string; metadata?: Record<string, string> };

/** `spec.scaling`: direct KEDA scaling; the CRD requires at least one trigger and minReplicas <= maxReplicas. */
export type ModelScaling = { minReplicas: number; maxReplicas: number; triggers: KedaTrigger[] };

export type GatewayRef = { name: string; namespace: string };

export type ModelAddress = { name: string; url: string; models: string[] };

export type AppliedConfig = { name: string; namespace?: string; source: string };

/** One label or claim requirement of a Placement (`In | NotIn | Exists | DoesNotExist`). */
export type MatchExpression = { key: string; operator: string; values?: string[] };

export type Toleration = { key: string; operator?: string; value?: string; effect?: string; tolerationSeconds?: number };

/** The ACM Placement a model is deployed with: one predicate over the cluster labels and claims. */
export type PlacementSpec = {
  clusterSets?: string[];
  matchLabels?: Record<string, string>;
  matchExpressions?: MatchExpression[];
  claimExpressions?: MatchExpression[];
  tolerations?: Toleration[];
  numberOfClusters?: number;
};

export type ModelPlacement = PlacementSpec & {
  /** The PlacementDecision's clusters, in name order. */
  selectedClusters: string[];
  /** `PlacementSatisfied` with its reason and message. */
  satisfied: boolean;
  reason?: string;
  message?: string;
  conditions: ClusterCondition[];
};

export type RolloutStrategy = 'All' | 'Progressive' | 'ProgressivePerGroup';

export type RolloutSpec = {
  strategy?: RolloutStrategy;
  maxConcurrency?: string;
  maxFailures?: string;
  progressDeadline?: string;
  minSuccessTime?: string;
};

export type RolloutSummary = { total: number; applied: number; available: number; progressing: number; degraded: number; updated: number };

/** One generated ManifestWork: the model's state on one site. Condition statuses are absent until the agent writes them. */
export type WorkStatus = {
  cluster: string;
  workName: string;
  applied?: ClusterCondition['status'];
  available?: ClusterCondition['status'];
  progressing?: ClusterCondition['status'];
  degraded?: ClusterCondition['status'];
  feedback: { ready?: string; url?: string };
  conditions: ClusterCondition[];
  generation: number;
  observedGeneration: number;
};

export type ModelRollout = RolloutSpec & {
  strategy: RolloutStrategy;
  summary: RolloutSummary;
  /** `PlacementRolledOut` True; `ManifestworkApplied` True and its reason. */
  rolledOut: boolean;
  applied: boolean;
  reason?: string;
  conditions: ClusterCondition[];
  works: WorkStatus[];
};

/** A KServe LLMInferenceService, optionally fanned out to managed clusters, as the BFF exposes it. */
export type Model = {
  name: string;
  namespace: string;
  displayName?: string;
  description?: string;
  modelUri: string;
  modelName: string;
  runtimeImage?: string;
  runtime?: string;
  /** Absent when the model autoscales. */
  replicas?: number;
  scaling?: ModelScaling;
  baseRefs: string[];
  requests: Record<string, string>;
  limits: Record<string, string>;
  env: EnvVar[];
  gateways: GatewayRef[];
  phase?: ModelPhase;
  reason?: string;
  message?: string;
  url?: string;
  addresses: ModelAddress[];
  conditions: ClusterCondition[];
  appliedConfigs: AppliedConfig[];
  /** Present for a model deployed to managed clusters. */
  placement?: ModelPlacement;
  rollout?: ModelRollout;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  resourceVersion?: string;
  generation?: number;
  creationTimestamp?: string;
  deletionTimestamp?: string;
};

/** Query of GET /api/v1/models. */
export type ListModelsParams = {
  namespace?: string;
  /** Exact label matches, each sent as `label=key=value`. */
  labels?: Record<string, string>;
  offset?: number;
  limit?: number;
};

export type ModelPage = { items: Model[]; meta: ListMeta };

/**
 * Body of POST /api/v1/models: the deploy wizard's inputs. `cpu`, `memory` and
 * `gpuCount` become the main container's requests; `scaling` (exclusive with
 * `replicas`) is direct KEDA scaling; `placement` makes the model multi-site;
 * `rollout` defaults to `All`.
 */
export type ModelCreate = {
  name: string;
  namespace: string;
  displayName?: string;
  description?: string;
  modelUri: string;
  modelName?: string;
  runtimeImage?: string;
  runtime?: string;
  replicas?: number;
  scaling?: ModelScaling;
  baseRefs?: string[];
  cpu?: string;
  memory?: string;
  gpuCount?: number;
  env?: EnvVar[];
  gateway?: GatewayRef;
  placement?: PlacementSpec;
  rollout?: RolloutSpec;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

/**
 * Body of PATCH /api/v1/models/{namespace}/{name}. Absent fields are left
 * alone; a present field replaces the stored one as a whole; `placement: null`
 * makes the model a hub deployment again.
 */
export type ModelPatch = {
  replicas?: number;
  runtimeImage?: string;
  env?: EnvVar[];
  placement?: PlacementSpec | null;
  rollout?: RolloutSpec;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  displayName?: string;
  description?: string;
};

/** What the hub can do, from GET /api/v1/capabilities. */
export type Capabilities = {
  /** False on the dev hub: a model with a placement is refused with 412. */
  manifestWorkReplicaSetEnabled: boolean;
  observabilityInstalled: boolean;
  acmVersion: string;
};
