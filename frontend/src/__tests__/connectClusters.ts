// The backend's Clusters API for page tests, over the clusters of a MockConsoleService: the same
// clusters answer GET /api/v1/clusters (the BFF's membership and state) and Clusters/List, Get and
// Update over Connect (fakeClients: the generated messages, serialized as JSON), so a test that
// changes `service.clusters`, or replaces `listClusters`, `getCluster`, `enrollCluster` or
// `removeClusterFromGrid`, changes both, as one hub would.
import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { Code, ConnectError, type Transport } from '@connectrpc/connect';
import { ServiceError } from '../api/ConsoleService';
import type { ConsoleService } from '../api/ConsoleService';
import type { GridMembership } from '../api/clusters';
import { fakeClients, type FakeBackend } from '../api/connect/testing';
import type { GridCluster } from '../api/types';
import { ManagedClusterSchema, type ManagedCluster } from '../gen/ai_grid/v1/managed_cluster_type_pb';

/** The writes a MockConsoleService makes; a service without them refuses Update. */
type Writes = {
  enrollCluster?: (cluster: GridCluster, membership: GridMembership) => Promise<GridCluster>;
  removeClusterFromGrid?: (cluster: GridCluster) => Promise<GridCluster>;
};

const codes: Record<number, Code> = {
  401: Code.Unauthenticated,
  403: Code.PermissionDenied,
  404: Code.NotFound,
  409: Code.Aborted,
  412: Code.FailedPrecondition,
  422: Code.InvalidArgument,
  500: Code.Internal,
  501: Code.Unimplemented,
  503: Code.Unavailable,
};

/** A ServiceError as the backend's Connect error with the same meaning. */
const asConnectError = (err: unknown) =>
  err instanceof ServiceError
    ? new ConnectError(err.message, codes[err.status] ?? Code.Unknown)
    : ConnectError.from(err);

const call = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    throw asConnectError(err);
  }
};

const availableCondition = { Ready: 'True', Offline: 'False', Unknown: '' } as const;

/** A GridCluster as the backend's ManagedCluster: the keys clusterView.ts reads back. */
export const toManagedCluster = (c: GridCluster): ManagedCluster => {
  const labels: Record<string, string> = { ...c.labels };
  if (c.location) labels.location = c.location;
  if (c.site) labels['ai-grid/site'] = c.site;
  if (c.region) labels['ai-grid/region'] = c.region;
  if (c.openshiftVersion) labels.openshiftVersion = c.openshiftVersion;
  const annotations: Record<string, string> = {};
  if (c.siteName) annotations['ai-grid/site-name'] = c.siteName;
  if (c.latitude !== undefined) annotations['ai-grid/latitude'] = String(c.latitude);
  if (c.longitude !== undefined) annotations['ai-grid/longitude'] = String(c.longitude);
  const claims = [
    ['consoleurl.cluster.open-cluster-management.io', c.consoleUrl],
    ['platform.open-cluster-management.io', c.platform],
    ['product.open-cluster-management.io', c.product],
  ].flatMap(([name, value]) => (value ? [{ name, value }] : []));
  // The mock's capacity is undefined without one; its gpuCapacity is the device plugin's count.
  const capacity =
    c.capacity && c.gpuCapacity !== undefined ? { ...c.capacity, 'nvidia.com/gpu': String(c.gpuCapacity) } : c.capacity;
  return create(ManagedClusterSchema, {
    id: c.name,
    metadata: {
      name: c.name,
      labels,
      annotations,
      version: Number(c.resourceVersion ?? 0),
      ...(c.creationTimestamp ? { creationTimestamp: timestampFromDate(new Date(c.creationTimestamp)) } : {}),
    },
    spec: { hubAcceptsClient: c.state !== 'Not accepted' },
    status: {
      availableCondition: availableCondition[c.status],
      provisioning: c.provisioned ? 'Compliant' : '',
      kubernetesVersion: c.kubernetesVersion ?? '',
      capacity: capacity ?? {},
      allocatable: c.allocatable ?? {},
      clusterClaims: claims,
      ...(c.gpus
        ? {
            gpus: {
              ...c.gpus,
              configurations: c.gpus.configurations.map((g) => ({ ...g, memoryMib: BigInt(g.memoryMib) })),
              nodes: c.gpus.nodes.map((n) => ({ ...n, memoryMib: BigInt(n.memoryMib) })),
            },
          }
        : {}),
    },
  });
};

/** Clusters/List, Get and Update over the service's clusters. */
export const clustersBackend = (service: Pick<ConsoleService, 'listClusters' | 'getCluster'> & Writes) =>
  ({
    list: async () => {
      const items = (await call(() => service.listClusters())).map(toManagedCluster);
      return { items, size: items.length, total: items.length };
    },
    get: async ({ id }) => ({ object: toManagedCluster(await call(() => service.getCluster(id))) }),
    update: async ({ object }) => {
      const id = object?.id ?? '';
      const labels = object?.metadata?.labels ?? {};
      const version = object?.metadata?.version ?? 0;
      // What the mock's writes read of the cluster they are given: its name, labels and version.
      const cluster: GridCluster = {
        name: id,
        status: 'Unknown',
        aiGridEnabled: false,
        provisioned: false,
        provisioningStatus: 'Not provisioned',
        addons: {},
        conditions: [],
        labels,
        resourceVersion: version ? String(version) : undefined,
      };
      const updated = await call(async () => {
        if (labels['ai-grid/enabled'] === 'true' && service.enrollCluster) {
          return service.enrollCluster(cluster, {
            location: labels.location ?? '',
            role: labels['ai-grid/role'] as GridMembership['role'],
          });
        }
        if (service.removeClusterFromGrid) return service.removeClusterFromGrid(cluster);
        throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
      });
      return { object: toManagedCluster(updated) };
    },
  }) satisfies FakeBackend['clusters'];

/** A Connect transport whose Clusters service is the service's clusters. */
export const transportFor = (service: Pick<ConsoleService, 'listClusters' | 'getCluster'> & Writes): Transport =>
  fakeClients({ clusters: clustersBackend(service) }).transport;
