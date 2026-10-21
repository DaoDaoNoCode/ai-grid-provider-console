import type { GridCluster } from './types';

/** What a spoke runs, as the hub's Placements read it from the `ai-grid/role` label. */
export type ClusterRole = 'combined' | 'ingress' | 'inference';

/** What Add to AI Grid writes besides `ai-grid/enabled`; the hub provisions nothing without a role. */
export type GridMembership = { location: string; role: ClusterRole };

/** The Clusters area: ManagedClusters and AI Grid membership. */
export interface ClustersService {
  listClusters(): Promise<GridCluster[]>;
  /**
   * Adds the cluster to AI Grid (labels `ai-grid/enabled: "true"`, `ai-grid/role` and `location`,
   * written with the rest of the labels it was read with, at the version it was read at) and
   * returns it as the hub now has it.
   */
  enrollCluster(cluster: GridCluster, membership: GridMembership): Promise<GridCluster>;
  /**
   * Takes the cluster out of AI Grid (drops the `ai-grid/enabled` label the same way, keeping the
   * other labels) and returns it as the hub now has it.
   */
  removeClusterFromGrid(cluster: GridCluster): Promise<GridCluster>;
}
