import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { Code } from '@connectrpc/connect';
import { useQuery } from '@connectrpc/connect-query';
import { list } from '../../gen/ai_grid/v1/clusters_service-Clusters_connectquery';
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
  const wrapper = ({ children }: PropsWithChildren) => (
    <BackendProvider checkSession={checkSession}>{children}</BackendProvider>
  );
  const { result } = renderHook(() => useQuery(list, {}, { retry: false }), { wrapper });
  await waitFor(() => expect(result.current.error?.code).toBe(Code.Unauthenticated));
  expect(checkSession).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`${window.location.origin}/ai_grid.v1.Clusters/List`);
});
