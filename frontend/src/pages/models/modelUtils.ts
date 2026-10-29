import type { ClusterView } from '../clusters/clusterView';
import type { NotFound } from '../../components/LoadError';

/** A model deployment's page, by the backend's model id. */
export const modelPath = (model: { id: string }) => `/models/${encodeURIComponent(model.id)}`;

/** Each location's site name, from the first cluster at that location that has one. */
export const siteNamesOf = (clusters: Pick<ClusterView, 'location' | 'siteName'>[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const cluster of clusters) {
    if (cluster.location && cluster.siteName && !names.has(cluster.location)) {
      names.set(cluster.location, cluster.siteName);
    }
  }
  return names;
};

/** "Paris DC1 (paris)", or the bare location when no cluster names its site. */
export const locationLabel = (location: string, siteNames: Map<string, string>): string => {
  const site = siteNames.get(location);
  return site ? `${site} (${location})` : location;
};

/** What a model page says when there is no such deployment. */
export const modelNotFound = (id: string): NotFound => ({
  what: 'Model deployment',
  name: id,
  listPath: '/models',
  listLabel: 'Models',
});
