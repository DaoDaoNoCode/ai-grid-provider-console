import { useCallback, useMemo } from 'react';
import { createClient, type Client } from '@connectrpc/connect';
import { useQuery as useConnectQuery, useTransport } from '@connectrpc/connect-query';
import { useQuery } from '@tanstack/react-query';
import type { ClustersService, GridMembership } from '../../api/clusters';
import { ServiceError } from '../../api/ConsoleService';
import { toServiceError } from '../../api/connect/errors';
import type { GridCluster } from '../../api/types';
import { useConsoleSession } from '../../context/useConsoleSession';
import { Clusters } from '../../gen/ai_grid/v1/clusters_service_pb';
import { get, list } from '../../gen/ai_grid/v1/clusters_service-Clusters_connectquery';
import {
  LABEL_ENABLED,
  LABEL_LOCATION,
  LABEL_ROLE,
  toClusterView,
  type ClusterView,
  type Membership,
} from './clusterView';

/** The pages poll as useServiceData does. */
const POLL_MS = 30_000;

type Loaded<T> = {
  data: T;
  /** Both answers have arrived (or failed) at least once. */
  loaded: boolean;
  error?: Error;
  /** When both answers last arrived (ms since the epoch), once both have. */
  updatedAt?: number;
  /** Loads again; a newer call replaces one still running. True when both loads succeeded. */
  refresh: () => Promise<boolean>;
};

const membershipOf = ({ aiGridEnabled, state, statusMessage }: GridCluster): Membership => ({
  aiGridEnabled,
  state,
  statusMessage,
});

/**
 * The first failure of the two loads as a ServiceError, as LoadError and the pages read it. As
 * useServiceData does, an ended session (401) after a successful load shows nothing: the console
 * shows the session-ended page once.
 */
const errorOf = (hasData: boolean, ...errors: unknown[]): Error | undefined => {
  const raw = errors.find(Boolean);
  if (!raw) return undefined;
  const err = raw instanceof ServiceError ? raw : toServiceError(raw);
  return hasData && err.isUnauthenticated ? undefined : err;
};

/** The query options both loads share: poll until the session ends, and no retries (the page offers Retry). */
const useLoadOptions = () => {
  const { sessionEnded } = useConsoleSession();
  return { refetchInterval: sessionEnded ? (false as const) : POLL_MS, retry: false };
};

/**
 * Every ManagedCluster from Clusters/List, with the BFF's membership and state for each from
 * GET /api/v1/clusters (clusterView.ts says why). A cluster the BFF hasn't listed yet shows as
 * outside AI Grid until the next answer.
 */
export const useClusterList = (service: Pick<ClustersService, 'listClusters'>): Loaded<ClusterView[]> => {
  const options = useLoadOptions();
  const objects = useConnectQuery(list, {}, options);
  const memberships = useQuery({ queryKey: ['api/v1/clusters'], queryFn: () => service.listClusters(), ...options });
  const { refetch: refetchObjects } = objects;
  const { refetch: refetchMemberships } = memberships;
  const data = useMemo(() => {
    if (!objects.data || !memberships.data) return [];
    const byName = new Map(memberships.data.map((c) => [c.name, membershipOf(c)]));
    return objects.data.items.map((mc) => toClusterView(mc, byName.get(mc.id)));
  }, [objects.data, memberships.data]);
  const refresh = useCallback(
    async () => (await Promise.all([refetchObjects(), refetchMemberships()])).every((r) => r.isSuccess),
    [refetchObjects, refetchMemberships],
  );
  return {
    data,
    loaded: objects.isFetched && memberships.isFetched,
    error: errorOf(!!objects.data && !!memberships.data, objects.error, memberships.error),
    updatedAt:
      objects.data && memberships.data ? Math.min(objects.dataUpdatedAt, memberships.dataUpdatedAt) : undefined,
    refresh,
  };
};

/** One cluster from Clusters/Get, with the BFF's membership from GET /api/v1/clusters/{name}. */
export const useCluster = (
  service: Pick<ClustersService, 'getCluster'>,
  name: string,
): Loaded<ClusterView | undefined> => {
  const options = useLoadOptions();
  const object = useConnectQuery(get, { id: name }, options);
  const membership = useQuery({
    queryKey: ['api/v1/clusters', name],
    queryFn: () => service.getCluster(name),
    ...options,
  });
  const { refetch: refetchObject } = object;
  const { refetch: refetchMembership } = membership;
  const data = useMemo(
    () =>
      object.data?.object && membership.data
        ? toClusterView(object.data.object, membershipOf(membership.data))
        : undefined,
    [object.data, membership.data],
  );
  const refresh = useCallback(
    async () => (await Promise.all([refetchObject(), refetchMembership()])).every((r) => r.isSuccess),
    [refetchObject, refetchMembership],
  );
  return {
    data,
    loaded: object.isFetched && membership.isFetched,
    error: errorOf(!!data, object.error, membership.error),
    refresh,
  };
};

/** The cluster as the backend and the BFF have it now, for the dialog after a conflict. */
const loadCluster = async (
  client: Client<typeof Clusters>,
  service: Pick<ClustersService, 'getCluster'>,
  name: string,
): Promise<ClusterView | undefined> => {
  const [{ object }, membership] = await Promise.all([client.get({ id: name }), service.getCluster(name)]);
  return object && toClusterView(object, membershipOf(membership));
};

/**
 * Writes the labels with Clusters/Update: the whole map as read with the change in it, at the
 * version it was read at (`lock`, so a stale one is Aborted, shown as a conflict). The backend
 * answers with the cluster as the hub has it now; the membership label must be what was sent, or
 * the change isn't confirmed. The state behind Unknown is the one read before.
 */
const writeLabels = async (
  client: Client<typeof Clusters>,
  cluster: ClusterView,
  labels: Record<string, string>,
  join: boolean,
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
  const confirmed = object.metadata?.labels[LABEL_ENABLED] === labels[LABEL_ENABLED];
  return toClusterView(object, {
    aiGridEnabled: confirmed ? join : !join,
    state: cluster.state,
    statusMessage: cluster.statusMessage,
  });
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
export const useMembershipWrites = (service: Pick<ClustersService, 'getCluster'>): MembershipWrites => {
  const transport = useTransport();
  return useMemo(() => {
    const client = createClient(Clusters, transport);
    return {
      enrollCluster: (cluster, { location, role }) =>
        writeLabels(
          client,
          cluster,
          { ...cluster.labels, [LABEL_ENABLED]: 'true', [LABEL_ROLE]: role, [LABEL_LOCATION]: location },
          true,
        ),
      removeClusterFromGrid: (cluster) => {
        const labels = { ...cluster.labels };
        delete labels[LABEL_ENABLED];
        return writeLabels(client, cluster, labels, false);
      },
      loadCluster: (name) => loadCluster(client, service, name),
    };
  }, [transport, service]);
};
