import type { ClustersService, GridMembership } from '../../api/clusters';
import { ServiceError } from '../../api/ConsoleService';
import type { GridCluster } from '../../api/types';
import { ClusterChangedError } from './ClusterChangedError';
import type { MembershipChange } from './MembershipModal';

type Options = {
  /** Loads the cluster as the backend has it now; undefined when it can't. */
  reload: (name: string) => Promise<GridCluster | undefined>;
  /**
   * After a conflict, with the cluster as loaded again (undefined when it couldn't be): the page
   * gives the open dialog that version, so the next try sends what the backend has now.
   */
  onConflict: (current: GridCluster | undefined) => void;
};

/**
 * Adds the cluster to AI Grid (with a membership) or removes it, for the Clusters list and the
 * cluster's page alike. When the cluster changed since the dialog opened (409), the PATCH carried
 * old labels and an old version: it loads the cluster again, hands it to onConflict and throws
 * ClusterChangedError, and the dialog decides whether the user's location and role still stand.
 * Returns the cluster as the backend answered; throws for the dialog to show.
 */
export const changeMembership = async (
  service: Pick<ClustersService, 'enrollCluster' | 'removeClusterFromGrid'>,
  { cluster, join }: MembershipChange,
  membership: GridMembership | undefined,
  { reload, onConflict }: Options,
): Promise<GridCluster> => {
  let updated: GridCluster;
  try {
    updated = membership
      ? await service.enrollCluster(cluster, membership)
      : await service.removeClusterFromGrid(cluster);
  } catch (err) {
    if (err instanceof ServiceError && err.isConflict) {
      const current = await reload(cluster.name).catch(() => undefined);
      onConflict(current);
      throw new ClusterChangedError(current);
    }
    throw err;
  }
  if (updated.aiGridEnabled !== join) {
    throw new Error('The Hub did not confirm the change. Refresh and try again.');
  }
  return updated;
};
