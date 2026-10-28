// A cluster's site, as the backend's status.location gives it (site.ts).
import { SubtleText } from '../../components/SubtleText';
import { EMPTY_VALUE } from '../../utilities/format';
import type { ClusterView } from './clusterView';
import { MissingLabel } from './MissingLabel';
import { isApproximate, siteOf } from './site';

type Located = Pick<ClusterView, 'name' | 'siteName' | 'region' | 'locationSource' | 'locationProblem'>;

/**
 * The site's name or the cloud region, marked approximate when the map position comes from the
 * region, and a warning with what to fix when the coordinate annotations are wrong.
 */
export const ClusterSite: React.FC<{ cluster: Located; testId: string }> = ({ cluster, testId }) => {
  const text = siteOf(cluster);
  if (cluster.locationProblem) {
    return (
      <MissingLabel testId={testId} reason={cluster.locationProblem}>
        {text ?? 'Position not readable'}
      </MissingLabel>
    );
  }
  if (!text) return <>{EMPTY_VALUE}</>;
  return (
    <span data-testid={testId}>
      {text}
      {isApproximate(cluster) && (
        <>
          {' '}
          <SubtleText>approximate</SubtleText>
        </>
      )}
    </span>
  );
};
