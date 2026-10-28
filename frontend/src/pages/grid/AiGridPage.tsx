import { useMemo } from 'react';
import type { ClustersService } from '../../api/clusters';
import { useClusterList } from '../clusters/useClusters';
import { GridPage } from './GridPage';

type Props = { service: React.ComponentProps<typeof GridPage>['service'] & ClustersService };

/**
 * The AI Grid map at /ai-grid: the members among the clusters of Clusters/List (over Connect, with
 * the BFF's membership, as the Clusters page shows them), by name. Their place on the map is the
 * cluster's own ai-grid/latitude and ai-grid/longitude annotations (clusterView.ts).
 */
export const AiGridPage: React.FC<Props> = ({ service }) => {
  const { data, loaded, error, updatedAt, refresh } = useClusterList(service);
  // None until both answers are in (updatedAt); after that a failed reload keeps the last ones.
  const read = updatedAt !== undefined;
  const clusters = useMemo(
    () => (read ? data.filter((c) => c.aiGridEnabled).sort((a, b) => a.name.localeCompare(b.name)) : undefined),
    [data, read],
  );
  return <GridPage service={service} map={{ clusters, loaded, error, updatedAt, refresh }} />;
};
