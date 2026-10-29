import { useCallback, useMemo } from 'react';
import { createClient, type Client } from '@connectrpc/connect';
import { useQuery as useConnectQuery, useTransport } from '@connectrpc/connect-query';
import type { GridMembership } from '../../api/clusters';
import { toServiceError } from '../../api/connect/errors';
import { useConsoleSession } from '../../context/useConsoleSession';
import { Clusters } from '../../gen/ai_grid/v1/clusters_service_pb';
import { get, list } from '../../gen/ai_grid/v1/clusters_service-Clusters_connectquery';
import { LABEL_ENABLED, LABEL_LOCATION, LABEL_ROLE, toClusterView, type ClusterView } from './clusterView';

/** The pages poll as useServiceData does. */
const POLL_MS = 30_000;

export type Loaded<T> = {
  data: T;
  /** The answer has arrived (or failed) at least once. */
  loaded: boolean;
  error?: Error;
  /** When the answer last arrived (ms since the epoch). */
  updatedAt?: number;
  /** Loads again; a newer call replaces one still running. True when the load succeeded. */
  refresh: () => Promise<boolean>;
};

/**
 * A failure as a ServiceError, as LoadError and the pages read it. As useServiceData does, an
 * ended session (401) after a successful load shows nothing: the console shows the session-ended
 * page once.
 */
export const loadErrorOf = (hasData: boolean, raw: unknown): Error | undefined => {
  if (!raw) return undefined;
  const err = toServiceError(raw);
  return hasData && err.isUnauthenticated ? undefined : err;
};

/** The query options both loads share: poll until the session ends, and no retries (the page offers Retry). */
export const useLoadOptions = () => {
  const { sessionEnded } = useConsoleSession();
  return { refetchInterval: sessionEnded ? (false as const) : POLL_MS, retry: false };
};

/** Every ManagedCluster from Clusters/List. */
export const useClusterList = (): Loaded<ClusterView[]> => {
  const objects = useConnectQuery(list, {}, useLoadOptions());
  const { refetch } = objects;
  const data = useMemo(() => objects.data?.items.map(toClusterView) ?? [], [objects.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return {
    data,
    loaded: objects.isFetched,
    error: loadErrorOf(!!objects.data, objects.error),
    updatedAt: objects.data ? objects.dataUpdatedAt : undefined,
    refresh,
  };
};

/** One cluster from Clusters/Get. */
export const useCluster = (name: string): Loaded<ClusterView | undefined> => {
  const object = useConnectQuery(get, { id: name }, useLoadOptions());
  const { refetch } = object;
  const data = useMemo(() => object.data?.object && toClusterView(object.data.object), [object.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return { data, loaded: object.isFetched, error: loadErrorOf(!!data, object.error), refresh };
};

/** The cluster as the backend has it now, for the dialog after a conflict. */
const loadCluster = async (client: Client<typeof Clusters>, name: string): Promise<ClusterView | undefined> => {
  const { object } = await client.get({ id: name });
  return object && toClusterView(object);
};

/**
 * Writes the labels with Clusters/Update: the whole map as read with the change in it, at the
 * version it was read at (`lock`, so a stale one is Aborted, shown as a conflict). The backend
 * answers with the cluster as the hub has it now, its `ai_grid_member` included, which
 * changeMembership checks.
 */
const writeLabels = async (
  client: Client<typeof Clusters>,
  cluster: ClusterView,
  labels: Record<string, string>,
): Promise<ClusterView> => {
  let object;
  try {
    ({ object } = await client.update({
      object: { id: cluster.name, metadata: { labels, version: cluster.version } },
      updateMask: { paths: ['metadata.labels'] },
      lock: true,
    }));
  } catch (err) {
    throw toServiceError(err);
  }
  if (!object) {
    throw new Error('The Hub did not confirm the change. Refresh and try again.');
  }
  return toClusterView(object);
};

/** What Add to AI Grid and Remove from AI Grid write, and how a page loads one cluster again. */
export type MembershipWrites = {
  enrollCluster: (cluster: ClusterView, membership: GridMembership) => Promise<ClusterView>;
  removeClusterFromGrid: (cluster: ClusterView) => Promise<ClusterView>;
  loadCluster: (name: string) => Promise<ClusterView | undefined>;
};

/**
 * Add writes `ai-grid/enabled: "true"`, the role and the location; Remove drops `ai-grid/enabled`
 * and keeps the rest, so the role and location are there if the cluster is added again.
 */
export const useMembershipWrites = (): MembershipWrites => {
  const transport = useTransport();
  return useMemo(() => {
    const client = createClient(Clusters, transport);
    return {
      enrollCluster: (cluster, { location, role }) =>
        writeLabels(client, cluster, {
          ...cluster.labels,
          [LABEL_ENABLED]: 'true',
          [LABEL_ROLE]: role,
          [LABEL_LOCATION]: location,
        }),
      removeClusterFromGrid: (cluster) => {
        const labels = { ...cluster.labels };
        delete labels[LABEL_ENABLED];
        return writeLabels(client, cluster, labels);
      },
      loadCluster: (name) => loadCluster(client, name),
    };
  }, [transport]);
};
