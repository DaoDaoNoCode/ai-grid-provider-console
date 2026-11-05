import type { ApiCluster, ClusterState, ClusterStatus, GridCluster } from './types';

// The one place that turns the BFF's JSON into the types the pages read. It renames
// fields and picks display words; anything the backend should decide stays there.

const availability: Record<string, ClusterStatus> = { ready: 'Ready', offline: 'Offline' };

const states: Record<string, ClusterState> = {
  pendingimport: 'Pending import',
  importing: 'Importing',
  importfailed: 'Import failed',
  detaching: 'Detaching',
  notaccepted: 'Not accepted',
};

/**
 * Maps a cluster of GET /clusters, PATCH /clusters/{name}, or GET /grid/overview to the
 * PoC's GridCluster. Ready and offline keep their words; every other ACM state, and a
 * cluster without one, is Unknown, with the ACM word in `state`.
 */
export const toGridCluster = (json: ApiCluster): GridCluster => ({
  name: json.name,
  status: availability[json.status ?? ''] ?? 'Unknown',
  state: states[json.status ?? ''],
  statusMessage: json.statusMessage,
  aiGridEnabled: json.aiGridEnabled,
  provisioned: json.provisioned,
  // Membership first: right after Remove the hub can still report the cluster
  // provisioned until its ready Policy lets go of it.
  provisioningStatus: !json.aiGridEnabled ? 'Not provisioned' : json.provisioned ? 'Provisioned' : 'Provisioning',
  location: json.location,
  site: json.site,
  region: json.region,
  siteName: json.siteName,
  latitude: json.latitude,
  longitude: json.longitude,
  openshiftVersion: json.openshiftVersion,
  consoleUrl: json.consoleUrl,
  kubernetesVersion: json.kubernetesVersion,
  platform: json.platform,
  product: json.product,
  capacity: json.capacity,
  gpuCapacity: json.gpuCapacity,
  allocatable: json.allocatable,
  gpus: json.gpus,
  creationTimestamp: json.creationTimestamp,
  addons: json.addons ?? {},
  conditions: json.conditions ?? [],
  resourceVersion: json.resourceVersion,
  labels: json.labels ?? {},
});
