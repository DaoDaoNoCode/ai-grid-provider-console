// In the shape of opendatahub-io/odh-dashboard
// packages/ui-core/src/contexts/__tests__/NotificationWatcherContext.spec.tsx at
// 1e2cc01e1c33c27a1b4b87ca3305a1d34b084982, on the console's notification center.
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { memoryStorage } from '../__tests__/memoryStorage';
import { NotificationsProvider } from './NotificationsProvider';
import { NotificationWatcherProvider } from './NotificationWatcherProvider';
import { useNotifications, type ConsoleNotification } from './useNotifications';
import {
  NotificationResponseStatus,
  useNotificationWatcher,
  type NotificationWatcherContextValue,
  type NotificationWatcherResponse,
} from './useNotificationWatcher';

let seen: ConsoleNotification[] = [];
let watcher: NotificationWatcherContextValue;

const capture = (value: NotificationWatcherContextValue, notifications: ConsoleNotification[]) => {
  watcher = value;
  seen = notifications;
};

const Probe: React.FC = () => {
  const { notifications } = useNotifications();
  const value = useNotificationWatcher();
  useEffect(() => capture(value, notifications), [value, notifications]);
  return null;
};

const renderWatcher = () =>
  render(
    <NotificationsProvider storage={memoryStorage().get}>
      <NotificationWatcherProvider pollInterval={30_000}>
        <Probe />
      </NotificationWatcherProvider>
    </NotificationsProvider>,
  );

/** A callback that answers REPOLL `repolls` times, then `last`. */
const answers = (repolls: number, last: NotificationWatcherResponse) => {
  const callback = vi.fn<(signal: AbortSignal) => Promise<NotificationWatcherResponse>>();
  for (let i = 0; i < repolls; i++) callback.mockResolvedValueOnce({ status: NotificationResponseStatus.REPOLL });
  callback.mockResolvedValueOnce(last);
  return callback;
};

beforeEach(() => {
  seen = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));

it('turns SUCCESS into an unread success notification, with its links', async () => {
  renderWatcher();
  const callback = answers(0, {
    status: NotificationResponseStatus.SUCCESS,
    title: 'Model Widget deployed',
    actions: [{ title: 'View model', to: '/models/widget' }],
  });
  act(() => watcher.registerNotification({ callback }));
  await flush();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([
    expect.objectContaining({
      variant: 'success',
      title: 'Model Widget deployed',
      read: false,
      actions: [{ title: 'View model', to: '/models/widget' }],
    }),
  ]);
});

it('turns ERROR into a danger notification', async () => {
  renderWatcher();
  const callback = answers(0, {
    status: NotificationResponseStatus.ERROR,
    title: 'Unable to deploy model Widget',
    message: 'Why',
  });
  act(() => watcher.registerNotification({ callback }));
  await flush();
  expect(seen).toEqual([
    expect.objectContaining({ variant: 'danger', title: 'Unable to deploy model Widget', message: 'Why' }),
  ]);
});

it('says nothing for STOP, or for a callback that throws', async () => {
  renderWatcher();
  const stop = answers(0, { status: NotificationResponseStatus.STOP });
  const throws = vi.fn(() => Promise.reject(new Error('a bug')));
  act(() => {
    watcher.registerNotification({ callback: stop, callbackDelay: 10 });
    watcher.registerNotification({ callback: throws, callbackDelay: 10 });
  });
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(throws).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([]);
});

it('checks again after its delay on REPOLL, the poll interval by default, until a final answer', async () => {
  renderWatcher();
  const delayed = answers(2, { status: NotificationResponseStatus.SUCCESS, title: 'Delayed' });
  const byDefault = answers(1, { status: NotificationResponseStatus.SUCCESS, title: 'Default' });
  act(() => {
    watcher.registerNotification({ callback: delayed, callbackDelay: 1_000 });
    watcher.registerNotification({ callback: byDefault });
  });
  await flush();
  expect(delayed).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(999));
  expect(delayed).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(delayed).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(delayed).toHaveBeenCalledTimes(3);
  expect(seen.map((n) => n.title)).toEqual(['Delayed']);
  expect(byDefault).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(byDefault).toHaveBeenCalledTimes(2);
  expect(seen.map((n) => n.title)).toEqual(['Default', 'Delayed']);
  // Nothing polls after a final answer.
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(delayed).toHaveBeenCalledTimes(3);
  expect(byDefault).toHaveBeenCalledTimes(2);
});

it('aborts a watch on unregister: no further check, and its answer is ignored', async () => {
  renderWatcher();
  let release!: (r: NotificationWatcherResponse) => void;
  const signals: AbortSignal[] = [];
  const callback = vi.fn(
    (signal: AbortSignal) =>
      new Promise<NotificationWatcherResponse>((resolve) => {
        signals.push(signal);
        release = resolve;
      }),
  );
  act(() => watcher.registerNotification({ id: 'watch-1', callback, callbackDelay: 10 }));
  act(() => watcher.unregisterNotification('watch-1'));
  expect(signals[0].aborted).toBe(true);
  await act(async () => release({ status: NotificationResponseStatus.SUCCESS, title: 'Too late' }));
  expect(seen).toEqual([]);

  // A watch waiting for its next check is not checked again.
  const repolling = vi.fn(async () => ({ status: NotificationResponseStatus.REPOLL }) as const);
  act(() => watcher.registerNotification({ id: 'watch-2', callback: repolling, callbackDelay: 10 }));
  await flush();
  act(() => watcher.unregisterNotification('watch-2'));
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(repolling).toHaveBeenCalledTimes(1);
});

it('aborts every watch when the console unmounts', async () => {
  const { unmount } = renderWatcher();
  const signals: AbortSignal[] = [];
  const pending = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<NotificationWatcherResponse>(() => undefined);
  });
  const repolling = vi.fn(async () => ({ status: NotificationResponseStatus.REPOLL }) as const);
  act(() => {
    watcher.registerNotification({ callback: pending });
    watcher.registerNotification({ callback: repolling, callbackDelay: 10 });
  });
  await flush();
  unmount();
  expect(signals[0].aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(repolling).toHaveBeenCalledTimes(1);
});
