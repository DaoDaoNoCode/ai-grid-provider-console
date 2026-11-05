import type { ClusterView } from '../clusters/clusterView';
import { EMPTY_VALUE } from '../../utilities/format';

/**
 * The hub's clusters (Clusters/List), for each cluster's Site and Region on the model pages, as the
 * deploy wizard and the Clusters pages read them: Site is the cluster's site name (the
 * `ai-grid/site-name` annotation, `status.location.site_name`), Region its cloud region claim
 * (`status.location.region`).
 */
export type ClusterPlaces = Pick<ClusterView, 'name' | 'siteName' | 'region'>[];

const find = (clusters: ClusterPlaces, cluster: string) => clusters.find((c) => c.name === cluster);

/** A cluster's site name, or a dash when it has none: never its region. */
export const siteOf = (clusters: ClusterPlaces, cluster: string) => find(clusters, cluster)?.siteName ?? EMPTY_VALUE;

/** A cluster's cloud region, or a dash when the hub doesn't know it: never its site. */
export const regionOf = (clusters: ClusterPlaces, cluster: string) => find(clusters, cluster)?.region ?? EMPTY_VALUE;
