// What the Clusters pages and the AI Grid map show of a ManagedCluster from the backend's Clusters
// API (ai_grid.v1, read over Connect): a thin selector layer over the generated message (ADR-0002).
// Each field reads one documented key and words it; nothing here decides what a cluster is.
//
// Two things the pages show are meanings the pinned API doesn't carry yet, and still come from the
// BFF's GET /api/v1/clusters (its toGridCluster and FromV1Cluster), passed in as `Membership`:
// whether the cluster is an AI Grid member, and its ACM lifecycle state behind Unknown (Not
// accepted, Pending import, Detaching, ...) with the backend's message. They move when the backend
// adds them to ManagedClusterStatus (docs/connect.md, "Fields the pages still read from /api/v1").
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { ClusterGPUs, ManagedCluster } from '../../gen/ai_grid/v1/managed_cluster_type_pb';
import type { ClusterState, ClusterStatus, GridCluster, ProvisioningStatus } from '../../api/types';

/** What the BFF still decides for the Clusters pages: membership and the ACM state behind Unknown. */
export type Membership = Pick<GridCluster, 'aiGridEnabled' | 'state' | 'statusMessage'>;

/** A ManagedCluster as the Clusters pages and the map show it. */
export type ClusterView = {
  name: string;
  /** Ready, Offline or Unknown: the hub's Available condition, Unknown while the BFF reports a `state`. */
  status: ClusterStatus;
  state?: ClusterState;
  statusMessage?: string;
  aiGridEnabled: boolean;
  provisioningStatus: ProvisioningStatus;
  location?: string;
  site?: string;
  region?: string;
  siteName?: string;
  /** Both present or both absent. */
  latitude?: number;
  longitude?: number;
  openshiftVersion?: string;
  consoleUrl?: string;
  kubernetesVersion?: string;
  platform?: string;
  product?: string;
  /** Absent until the hub reports the cluster's resources. */
  capacity?: Record<string, string>;
  allocatable?: Record<string, string>;
  /** `capacity["nvidia.com/gpu"]` as a number: 0 without one, undefined without a capacity or for a negative count. */
  gpuCapacity?: number;
  gpus?: ClusterGPUs;
  creationTimestamp?: string;
  /** The labels as read, sent back whole by Add and Remove. */
  labels: Record<string, string>;
  /** `metadata.version`, sent back with `lock` by Add and Remove. */
  version: number;
};

// The keys read here. The labels and annotations are AI Grid's own (the backend lets the console
// write the ai-grid/* keys and the location label, ClustersUpdateRequest); the claims are the ones
// ManagedClusterStatus.cluster_claims documents; openshiftVersion is the label ACM sets.
export const LABEL_ENABLED = 'ai-grid/enabled';
export const LABEL_ROLE = 'ai-grid/role';
export const LABEL_LOCATION = 'location';
const LABEL_SITE = 'ai-grid/site';
const LABEL_REGION = 'ai-grid/region';
const LABEL_OPENSHIFT_VERSION = 'openshiftVersion';
const ANNOTATION_SITE_NAME = 'ai-grid/site-name';
const ANNOTATION_LATITUDE = 'ai-grid/latitude';
const ANNOTATION_LONGITUDE = 'ai-grid/longitude';
const CLAIM_CONSOLE_URL = 'consoleurl.cluster.open-cluster-management.io';
const CLAIM_PLATFORM = 'platform.open-cluster-management.io';
const CLAIM_PRODUCT = 'product.open-cluster-management.io';
const CAPACITY_GPU = 'nvidia.com/gpu';

/** The hub's Available condition as the PoC words it (available_condition: "useful for Ready/Offline/Unknown"). */
const availability = (condition: string | undefined): ClusterStatus =>
  condition === 'True' ? 'Ready' : condition === 'False' ? 'Offline' : 'Unknown';

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A coordinate annotation as a number within ±limit; anything else is no coordinate rather than a
 * pin in the wrong place. The backend refuses such a value on Update, so this only meets one
 * written to the hub another way.
 */
const coordinate = (value: string | undefined, limit: number): number | undefined => {
  const v = value?.trim();
  if (!v || !DECIMAL.test(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
};

/**
 * A device plugin's GPU count, a plain integer: another Kubernetes quantity spelling ("8k") reads
 * as 0, and so does none.
 */
const gpuQuantity = (value: string | undefined): number => (value && /^[+-]?\d+$/.test(value) ? Number(value) : 0);

const nonEmpty = (m: { [key: string]: string } | undefined) => (m && Object.keys(m).length ? m : undefined);

/** The cluster as the pages show it; `membership` is the BFF's answer for it, absent when it has none. */
export const toClusterView = (mc: ManagedCluster, membership?: Membership): ClusterView => {
  const labels = mc.metadata?.labels ?? {};
  const annotations = mc.metadata?.annotations ?? {};
  const status = mc.status;
  const claim = (name: string) => status?.clusterClaims.find((c) => c.name === name)?.value || undefined;
  const capacity = nonEmpty(status?.capacity);
  const gpus = gpuQuantity(capacity?.[CAPACITY_GPU]);
  const latitude = coordinate(annotations[ANNOTATION_LATITUDE], 90);
  const longitude = coordinate(annotations[ANNOTATION_LONGITUDE], 180);
  const mapped = latitude !== undefined && longitude !== undefined;
  const aiGridEnabled = membership?.aiGridEnabled ?? false;
  const created = mc.metadata?.creationTimestamp;
  return {
    name: mc.id,
    status: membership?.state ? 'Unknown' : availability(status?.availableCondition),
    state: membership?.state,
    statusMessage: membership?.statusMessage,
    aiGridEnabled,
    // Membership first: right after Remove the hub's ready Policy can still report the cluster
    // compliant until it lets go of it.
    provisioningStatus: !aiGridEnabled
      ? 'Not provisioned'
      : status?.provisioning === 'Compliant'
        ? 'Provisioned'
        : 'Provisioning',
    location: labels[LABEL_LOCATION] || undefined,
    site: labels[LABEL_SITE] || undefined,
    region: labels[LABEL_REGION] || undefined,
    siteName: annotations[ANNOTATION_SITE_NAME] || undefined,
    ...(mapped ? { latitude, longitude } : {}),
    openshiftVersion: labels[LABEL_OPENSHIFT_VERSION] || undefined,
    consoleUrl: claim(CLAIM_CONSOLE_URL),
    kubernetesVersion: status?.kubernetesVersion || undefined,
    platform: claim(CLAIM_PLATFORM),
    product: claim(CLAIM_PRODUCT),
    capacity,
    allocatable: nonEmpty(status?.allocatable),
    gpuCapacity: capacity && gpus >= 0 ? gpus : undefined,
    gpus: status?.gpus,
    creationTimestamp: created && timestampDate(created).toISOString(),
    labels,
    version: mc.metadata?.version ?? 0,
  };
};
