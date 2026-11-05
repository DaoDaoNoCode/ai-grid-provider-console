// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { notifyManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ConsoleSessionContext } from '../../context/useConsoleSession';
import { noteUserAction, UNSETTLED_POLL_MS, UNSETTLED_WINDOW_MS, useLoaded, useLoadOptions } from './useClusters';

/** An answer: what in it is still changing, in its status words; nothing when it has settled. */
type Answer = { changing?: string };

const changingOf = (answer: Answer) => answer.changing;
const select = (answer: Answer | undefined) => answer;

/**
 * A query polled as the pages poll (useLoaded over useLoadOptions), whose answer is `backend.answer`.
 * The answer resolves in microtasks only, so it is in before the fake clock moves on.
 */
const setup = (settledMs?: number | false, session: { sessionEnded?: boolean } = {}) => {
  const client = new QueryClient();
  const backend = { answer: { changing: 'model-a Starting' } as Answer };
  const queryFn = vi.fn(async () => ({ ...backend.answer }));
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConsoleSessionContext.Provider value={{ userLoaded: true, ...session }}>
        {children}
      </ConsoleSessionContext.Provider>
    </QueryClientProvider>
  );
  const mount = () =>
    renderHook(
      () => useLoaded(useQuery({ queryKey: ['answer'], queryFn, ...useLoadOptions(changingOf, settledMs) }), select),
      { wrapper },
    );
  /** How many calls the next `ms` of polling makes, 10 seconds of clock at a time. */
  const callsIn = async (ms: number) => {
    const before = queryFn.mock.calls.length;
    for (let elapsed = 0; elapsed < ms; elapsed += 10_000) {
      // Every answer is in before the clock moves: the window is measured when the answer arrives.
      expect(client.isFetching()).toBe(0);
      await act(() => vi.advanceTimersByTimeAsync(10_000));
    }
    return queryFn.mock.calls.length - before;
  };
  return { backend, queryFn, mount, callsIn };
};

describe('useLoadOptions', () => {
  // The polls and the clock are faked: refetchInterval's setInterval, and Date.now, which the cap
  // measures. Query notifies its observers' components at once rather than in a setTimeout of its
  // own, so a render (and the options it sets) happens within the step that brought the answer.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    notifyManager.setScheduler((callback) => callback());
  });
  afterEach(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    vi.useRealTimers();
  });

  /** Mounts, waits for the first answer, and polls until the fast window is over (30 s past it). */
  const pastTheCap = async (s: ReturnType<typeof setup>) => {
    const hook = s.mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(hook.result.current.data).toEqual(s.backend.answer);
    await s.callsIn(UNSETTLED_WINDOW_MS + 30_000);
    return hook;
  };

  it('polls every 10 seconds for 5 minutes while the same thing stays unsettled, then every 30', async () => {
    expect(UNSETTLED_POLL_MS).toBe(10_000);
    expect(UNSETTLED_WINDOW_MS).toBe(300_000);
    const s = setup();
    s.mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(s.queryFn).toHaveBeenCalledTimes(1);
    expect(await s.callsIn(UNSETTLED_WINDOW_MS)).toBe(30);
    expect(await s.callsIn(10_000)).toBe(0);
    expect(await s.callsIn(20_000)).toBe(1);
    expect(await s.callsIn(90_000)).toBe(3);
  });

  it('polls every 30 seconds once nothing is unsettled', async () => {
    const s = setup();
    s.backend.answer = {};
    s.mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(await s.callsIn(10_000)).toBe(0);
    expect(await s.callsIn(20_000)).toBe(1);
  });

  it('polls fast again when what is unsettled changes', async () => {
    const s = setup();
    await pastTheCap(s);
    expect(await s.callsIn(10_000)).toBe(0);
    // The next 30-second poll finds something new changing; fast polling starts again from it.
    s.backend.answer = { changing: 'model-a Syncing' };
    expect(await s.callsIn(20_000)).toBe(1);
    expect(await s.callsIn(UNSETTLED_WINDOW_MS)).toBe(30);
    expect(await s.callsIn(10_000)).toBe(0);
  });

  it('polls fast again after a Refresh', async () => {
    const s = setup();
    const hook = await pastTheCap(s);
    expect(await s.callsIn(10_000)).toBe(0);
    await act(async () => {
      expect(await hook.result.current.refresh()).toBe(true);
    });
    // The first load, 30 fast polls, one at 30 seconds, then the Refresh.
    expect(s.queryFn).toHaveBeenCalledTimes(1 + 30 + 1 + 1);
    expect(await s.callsIn(30_000)).toBe(3);
  });

  it("polls fast again after the user's write lands", async () => {
    const s = setup();
    await pastTheCap(s);
    expect(await s.callsIn(10_000)).toBe(0);
    // As BackgroundWritesProvider does when a write lands; the next poll's answer starts the window.
    noteUserAction();
    expect(await s.callsIn(20_000)).toBe(1);
    expect(await s.callsIn(30_000)).toBe(3);
  });

  it('polls fast again when the page mounts again', async () => {
    const s = setup();
    const hook = await pastTheCap(s);
    expect(await s.callsIn(10_000)).toBe(0);
    hook.unmount();
    s.mount();
    // The cached answer is stale: the mount loads it again, and starts a window of its own.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(await s.callsIn(30_000)).toBe(3);
  });

  it('falls back to 30 seconds after the cap where nothing is polled once settled', async () => {
    const s = setup(false);
    await pastTheCap(s);
    expect(await s.callsIn(10_000)).toBe(0);
    expect(await s.callsIn(20_000)).toBe(1);
    // Settled: this load stops polling.
    s.backend.answer = {};
    expect(await s.callsIn(30_000)).toBe(1);
    expect(await s.callsIn(120_000)).toBe(0);
  });

  it('stops polling once the session has ended, and does not retry', async () => {
    const s = setup(undefined, { sessionEnded: true });
    s.mount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(await s.callsIn(60_000)).toBe(0);
    expect(s.queryFn).toHaveBeenCalledTimes(1);
  });
});
