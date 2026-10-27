import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { Code } from '@connectrpc/connect';
import { createConnectQueryKey, useMutation, useQuery } from '@connectrpc/connect-query';
import { useQueryClient } from '@tanstack/react-query';
import { Clusters } from '../../gen/ai_grid/v1/clusters_service_pb';
import { list, update } from '../../gen/ai_grid/v1/clusters_service-Clusters_connectquery';
import { BackendProvider } from './BackendProvider';
import { fakeClients } from './testing';

it('runs a generated query through the supplied transport', async () => {
  const { transport } = fakeClients({
    clusters: { list: (request) => ({ total: request.limit, items: [{ id: 'cluster-a' }] }) },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <BackendProvider transport={transport} checkSession={vi.fn()}>
      {children}
    </BackendProvider>
  );
  const { result } = renderHook(() => useQuery(list, { limit: 2 }, { retry: false }), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.total).toBe(2);
  expect(result.current.data?.items[0].id).toBe('cluster-a');
});

it('checks the session when its default transport gets an unauthenticated response', async () => {
  const checkSession = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 'unauthenticated', message: 'session expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  try {
    const wrapper = ({ children }: PropsWithChildren) => (
      <BackendProvider checkSession={checkSession}>{children}</BackendProvider>
    );
    const { result } = renderHook(() => useQuery(list, {}, { retry: false }), { wrapper });
    await waitFor(() => expect(result.current.error?.code).toBe(Code.Unauthenticated));
    expect(checkSession).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(`${window.location.origin}/ai_grid.v1.Clusters/List`);
  } finally {
    fetch.mockRestore();
  }
});

// The pattern docs/connect.md shows for a page: read with useQuery, write with useMutation, and
// refetch the service's queries once the write lands.
it("refetches a page's list after its update, as docs/connect.md shows", async () => {
  let labels: Record<string, string> = { location: 'paris' };
  const { transport } = fakeClients({
    clusters: {
      list: () => ({ total: 1, items: [{ id: 'site-a', metadata: { labels, version: 1 } }] }),
      update: (request) => {
        labels = request.object?.metadata?.labels ?? {};
        return { object: request.object };
      },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <BackendProvider transport={transport} checkSession={vi.fn()}>
      {children}
    </BackendProvider>
  );
  const { result } = renderHook(
    () => {
      const queryClient = useQueryClient();
      const clusters = useQuery(list, { limit: 50 });
      const save = useMutation(update, {
        onSuccess: () =>
          queryClient.invalidateQueries({
            queryKey: createConnectQueryKey({ schema: Clusters, cardinality: undefined }),
          }),
      });
      return { clusters, save };
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.clusters.data?.items[0].metadata?.labels).toEqual({ location: 'paris' }));
  await act(() =>
    result.current.save.mutateAsync({
      object: { id: 'site-a', metadata: { labels: { location: 'lyon' }, version: 1 } },
      updateMask: { paths: ['metadata.labels'] },
      lock: true,
    }),
  );
  await waitFor(() => expect(result.current.clusters.data?.items[0].metadata?.labels).toEqual({ location: 'lyon' }));
});
