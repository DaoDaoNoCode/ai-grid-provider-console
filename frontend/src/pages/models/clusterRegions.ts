import type { ClusterView } from '../clusters/clusterView';
import { EMPTY_VALUE } from '../../utilities/format';

/** The hub's clusters, for each cluster's region on the model pages. */
export type ClusterRegions = Pick<ClusterView, 'name' | 'region'>[];

/** A cluster's cloud region (its region claim), or a dash when the hub doesn't know it. */
export const regionOf = (clusters: ClusterRegions, cluster: string) =>
  clusters.find((c) => c.name === cluster)?.region ?? EMPTY_VALUE;
