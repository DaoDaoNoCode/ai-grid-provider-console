// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { Code, ConnectError } from '@connectrpc/connect';
import type { UseQueryResult } from '@tanstack/react-query';
import { useLoaded } from './useClusters';

type Answer = { items: string[]; object?: string };

/** The fields of a query result useLoaded reads. */
const query = (over: Partial<UseQueryResult<Answer, unknown>>): UseQueryResult<Answer, unknown> =>
  ({
    data: undefined,
    error: null,
    isFetched: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(async () => ({ isSuccess: true })),
    ...over,
  }) as unknown as UseQueryResult<Answer, unknown>;

const items = (answer: Answer | undefined) => answer?.items ?? [];
const object = (answer: Answer | undefined) => answer?.object;

describe('useLoaded', () => {
  it('is not loaded, with the selection of nothing, until the first answer', () => {
    const { result } = renderHook(() => useLoaded(query({}), items));
    expect(result.current).toMatchObject({ data: [], loaded: false, error: undefined, updatedAt: undefined });
  });

  it('selects the answer, keeps the selection between renders, and says when it arrived', () => {
    const answer = { items: ['a', 'b'] };
    const { result, rerender } = renderHook(() =>
      useLoaded(query({ data: answer, isFetched: true, dataUpdatedAt: 42 }), items),
    );
    const first = result.current.data;
    rerender();
    expect(result.current).toMatchObject({ data: ['a', 'b'], loaded: true, updatedAt: 42 });
    expect(result.current.data).toBe(first);
  });

  it('shows a failure as a ServiceError, and an ended session after data as nothing', () => {
    const failed = new ConnectError('down', Code.Unavailable);
    const ended = new ConnectError('gone', Code.Unauthenticated);
    expect(
      renderHook(() => useLoaded(query({ error: failed, isFetched: true }), items)).result.current.error,
    ).toMatchObject({
      status: 503,
    });
    // Without data an ended session is still the error; after data the console's session-ended page says it.
    expect(
      renderHook(() => useLoaded(query({ error: ended, isFetched: true }), items)).result.current.error,
    ).toMatchObject({
      status: 401,
    });
    expect(
      renderHook(() => useLoaded(query({ data: { items: [] }, error: ended, isFetched: true }), items)).result.current
        .error,
    ).toBeUndefined();
  });

  it('counts an answer without the selected object as no data, as a page for one object does', () => {
    const ended = new ConnectError('gone', Code.Unauthenticated);
    const { result } = renderHook(() =>
      useLoaded(query({ data: { items: [] }, error: ended, isFetched: true }), object),
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ status: 401 });
  });

  it('refreshes through the query and says whether that worked', async () => {
    const refetch = vi.fn(async () => ({ isSuccess: false }));
    const { result } = renderHook(() =>
      useLoaded(query({ refetch: refetch as unknown as UseQueryResult<Answer, unknown>['refetch'] }), items),
    );
    await expect(result.current.refresh()).resolves.toBe(false);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
