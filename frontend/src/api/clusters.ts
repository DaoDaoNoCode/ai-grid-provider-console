import type { GridCluster } from './types';

/** What a spoke runs, as the hub's Placements read it from the `ai-grid/role` label. */
export type ClusterRole = 'combined' | 'ingress' | 'inference';

/** What Add to AI Grid writes besides `ai-grid/enabled`; the hub provisions nothing without a role. */
export type GridMembership = { location: string; role: ClusterRole };

/**
 * The BFF's view of ManagedClusters (GET /api/v1/clusters). The Clusters pages and the map read the
 * clusters from the backend's Clusters API over Connect, and take only the BFF's membership and
 * lifecycle state from here (pages/clusters/clusterView.ts); the Models pages read site names.
 * Add and Remove write through Clusters/Update.
 */
export interface ClustersService {
  listClusters(): Promise<GridCluster[]>;
  /** One cluster by name; a ServiceError with status 404 when the hub has none. */
  getCluster(name: string): Promise<GridCluster>;
}
