import type { ClusterView } from '../clusters/clusterView';
import type { Loaded } from '../clusters/useClusters';
import { LoadFailedAlert } from '../../components/states/LoadFailedAlert';
import { StaleDataAlert } from '../../components/states/StaleDataAlert';

/**
 * Says when the Models pages couldn't load the hub's clusters (Clusters/List), whose Site and Region
 * they show: before any answer, Site and Region would read as dashes, as if no cluster had either;
 * after one, they are the last loaded. Nothing while the clusters load or have loaded.
 */
export const ClusterLoadNote: React.FC<{ clusters: Loaded<ClusterView[]> }> = ({ clusters }) => {
  const { data, error, refresh } = clusters;
  if (!error) return null;
  const retry = () => void refresh();
  return data.length > 0 ? (
    <StaleDataAlert object="clusters" error={error} onRetry={retry} />
  ) : (
    <LoadFailedAlert object="clusters" error={error} onRetry={retry}>
      Site and Region show a dash until the clusters load.
    </LoadFailedAlert>
  );
};
