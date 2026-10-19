import type { GridCluster } from './types';

/** The Clusters area: ManagedClusters and AI Grid membership. */
export interface ClustersService {
  listClusters(): Promise<GridCluster[]>;
  /**
   * Adds the cluster to AI Grid (label `ai-grid/enabled: "true"`, written with the rest of the
   * labels it was read with, at the version it was read at) and returns it as the hub now has it.
   */
  enrollCluster(cluster: GridCluster): Promise<GridCluster>;
  /**
   * Takes the cluster out of AI Grid (drops the `ai-grid/enabled` label the same way, keeping the
   * other labels) and returns it as the hub now has it.
   */
  removeClusterFromGrid(cluster: GridCluster): Promise<GridCluster>;
}
