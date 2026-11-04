// The notification center when the signed-in user changes in the same tab: the previous user's
// notifications and watches go, and the new user's are restored.
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { useQuery } from '@connectrpc/connect-query';
import { BackendProvider } from '../api/connect/BackendProvider';
import { fakeClients } from '../api/connect/testing';
import { ModelClusterStatusSchema, ModelPhase, ModelSchema } from '../gen/ai_grid/v1/model_type_pb';
import { list as listModels } from '../gen/ai_grid/v1/models_service-Models_connectquery';
import { memoryStorage } from '../__tests__/memoryStorage';
import { deferred } from '../__tests__/render';
import { BackgroundWritesProvider } from './BackgroundWritesProvider';
import { NotificationsProvider } from './NotificationsProvider';
import { notificationsKey, watchesKey } from './storageKeys';
import { NotificationWatcherProvider } from './NotificationWatcherProvider';
import { useBackgroundWrites, type BackgroundWritesValue } from './useBackgroundWrites';
import { useNotifications } from './useNotifications';
import { READY_MS, READY_POLL_MS } from './writeWatches';

const Titles: React.FC = () => {
  const { notifications } = useNotifications();
  return (
    <ul aria-label="Titles">
      {notifications.map((n) => (
        <li key={n.id}>{n.title}</li>
      ))}
    </ul>
  );
};

const entry = (id: string, title: string) => ({ id, variant: 'info', title, timestamp: Date.now(), read: true });
const watch = (id: string) => ({
  key: `w-${id}`,
  subject: 'model',
  op: 'create',
  id,
  name: id,
  stage: 'readback',
  since: Date.now(),
});

it("drops the previous user's notifications and watches, and restores the new user's", async () => {
  const storage = memoryStorage({
    [notificationsKey('alice')]: JSON.stringify([entry('a1', "Alice's notification")]),
    [watchesKey('alice')]: JSON.stringify([watch('alice-model')]),
    [notificationsKey('bob')]: JSON.stringify([entry('b1', "Bob's notification")]),
  });
  const gets: string[] = [];
  const { transport } = fakeClients({
    models: {
      get: ({ id }) => {
        gets.push(id);
        throw new ConnectError(`Model "${id}" not found`, Code.NotFound);
      },
    },
  });
  const tree = (owner: string) => (
    <BackendProvider transport={transport} checkSession={() => undefined}>
      <NotificationsProvider storage={storage.get} owner={owner}>
        <NotificationWatcherProvider>
          <BackgroundWritesProvider storage={storage.get} owner={owner}>
            <Titles />
          </BackgroundWritesProvider>
        </NotificationWatcherProvider>
      </NotificationsProvider>
    </BackendProvider>
  );
  const { rerender } = render(tree('alice'));
  expect(await screen.findByText("Alice's notification")).toBeVisible();
  // Alice's watch resumed: its read-back asked for her model.
  await waitFor(() => expect(gets).toContain('alice-model'));

  rerender(tree('bob'));
  expect(await screen.findByText("Bob's notification")).toBeVisible();
  expect(screen.queryByText("Alice's notification")).not.toBeInTheDocument();
  // Alice's records leave the tab, so nobody else sees or resumes them.
  expect(storage.values.has(notificationsKey('alice'))).toBe(false);
  expect(storage.values.has(watchesKey('alice'))).toBe(false);
});

let submitWrite: BackgroundWritesValue['submitWrite'] = async () => 'done';
const capture = (value: BackgroundWritesValue) => {
  submitWrite = value.submitWrite;
};

const Writes: React.FC = () => {
  const value = useBackgroundWrites();
  useEffect(() => capture(value), [value]);
  return null;
};

it("publishes nothing of a write into the next user's notifications or storage when the user changes during the form's wait", async () => {
  const storage = memoryStorage();
  const { transport } = fakeClients({});
  const waits: (() => void)[] = [];
  const formWait = () => new Promise<void>((resolve) => waits.push(resolve));
  const answer = deferred<void>();
  const tree = (owner: string) => (
    <BackendProvider transport={transport} checkSession={() => undefined}>
      <NotificationsProvider storage={storage.get} owner={owner}>
        <NotificationWatcherProvider>
          <BackgroundWritesProvider storage={storage.get} owner={owner} formWait={formWait}>
            <Titles />
            <Writes />
          </BackgroundWritesProvider>
        </NotificationWatcherProvider>
      </NotificationsProvider>
    </BackendProvider>
  );
  const { rerender } = render(tree('alice'));
  let outcome: Promise<string> = Promise.resolve('');
  act(() => {
    outcome = submitWrite({ subject: 'model', op: 'create', id: 'widget', name: 'Widget' }, () => answer.promise);
  });
  // Bob signs in while Alice's write is out, then the form's wait ends, then the answer comes.
  rerender(tree('bob'));
  await act(async () => waits.shift()?.());
  expect(await outcome).toBe('pending');
  await act(async () => answer.resolve());
  expect(screen.queryByText('Saving model Widget')).not.toBeInTheDocument();
  expect(screen.queryByText('Model Widget saved to Git')).not.toBeInTheDocument();
  expect(storage.values.get(watchesKey('bob'))).toBeUndefined();
  expect(storage.values.get(notificationsKey('bob'))).toBeUndefined();
});

/** A model placed on site-b, which hasn't reported it ready. */
const pendingOnSiteB = () =>
  create(ModelSchema, {
    id: 'widget',
    metadata: { name: 'widget', version: 1 },
    spec: { placement: { labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: ['site-b'] }] } } },
    status: {
      phase: ModelPhase.PENDING,
      placement: { selectedClusters: ['site-b'] },
      clusters: [{ cluster: 'site-b', phase: ModelPhase.PENDING, reason: 'NotReady' }],
    },
  });

const readyRecord = (since: number) => ({
  key: 'r1',
  subject: 'model',
  op: 'create',
  id: 'widget',
  name: 'Widget',
  stage: 'ready',
  since,
});

const signedIn = (storage: ReturnType<typeof memoryStorage>) => {
  const { transport } = fakeClients({ models: { get: () => ({ object: pendingOnSiteB() }) } });
  return render(
    <BackendProvider transport={transport} checkSession={() => undefined}>
      <NotificationsProvider storage={storage.get} owner="dev-user">
        <NotificationWatcherProvider>
          <BackgroundWritesProvider storage={storage.get} owner="dev-user">
            <Titles />
            <Writes />
          </BackgroundWritesProvider>
        </NotificationWatcherProvider>
      </NotificationsProvider>
    </BackendProvider>,
  );
};

it("warns that a deployed model isn't ready yet when its 30 minutes run out, instead of stopping silently", async () => {
  vi.useFakeTimers();
  try {
    // The watch has one check left inside its 30 minutes.
    const storage = memoryStorage({
      [watchesKey('dev-user')]: JSON.stringify([readyRecord(Date.now() - READY_MS + READY_POLL_MS / 2)]),
    });
    signedIn(storage);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("Model Widget isn't ready yet")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READY_POLL_MS);
    });
    expect(screen.getByText("Model Widget isn't ready yet")).toBeInTheDocument();
    expect(storage.values.get(watchesKey('dev-user'))).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it('watches a deployed model once, whatever earlier watch of the same id still runs', async () => {
  // A watch from a deploy of the same id (deleted and deployed again within its 30 minutes).
  const storage = memoryStorage({ [watchesKey('dev-user')]: JSON.stringify([readyRecord(Date.now())]) });
  signedIn(storage);
  await waitFor(() => expect(submitWrite).toBeDefined());
  await act(async () => {
    await submitWrite({ subject: 'model', op: 'create', id: 'widget', name: 'Widget' }, async () => undefined);
  });
  const ready = (
    JSON.parse(storage.values.get(watchesKey('dev-user')) ?? '[]') as { id: string; stage: string }[]
  ).filter((r) => r.stage === 'ready' && r.id === 'widget');
  expect(ready).toHaveLength(1);
});

/** The Models list as a page shows it, without a poll of its own: it refetches only when told to. */
const SiteBStatus: React.FC = () => {
  const { data } = useQuery(listModels, {});
  const widget = data?.items.find((m) => m.id === 'widget');
  const siteB = widget?.status?.clusters.find((c) => c.cluster === 'site-b');
  return <p>{`site-b ${siteB?.phase === ModelPhase.READY ? 'ready' : 'pending'}`}</p>;
};

it('refreshes the lists when a readiness watch sees the status change, and not on a poll that sees none', async () => {
  vi.useFakeTimers();
  try {
    let model = pendingOnSiteB();
    let listCalls = 0;
    const { transport } = fakeClients({
      models: {
        get: () => ({ object: model }),
        list: () => {
          listCalls += 1;
          return { items: [model], size: 1, total: 1 };
        },
      },
    });
    const storage = memoryStorage({ [watchesKey('dev-user')]: JSON.stringify([readyRecord(Date.now())]) });
    render(
      <BackendProvider transport={transport} checkSession={() => undefined}>
        <NotificationsProvider storage={storage.get} owner="dev-user">
          <NotificationWatcherProvider>
            <BackgroundWritesProvider storage={storage.get} owner="dev-user">
              <SiteBStatus />
              <Titles />
            </BackgroundWritesProvider>
          </NotificationWatcherProvider>
        </NotificationsProvider>
      </BackendProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('site-b pending')).toBeInTheDocument();
    expect(listCalls).toBe(1);

    // A poll that sees the same status leaves the list alone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READY_POLL_MS);
    });
    expect(listCalls).toBe(1);

    // site-b becomes ready (the whole model stays Pending, as an ingress cluster keeps it): the
    // watch says so, and the list shows it at once.
    model = pendingOnSiteB();
    model.status!.clusters = [
      create(ModelClusterStatusSchema, { cluster: 'site-b', phase: ModelPhase.READY, reason: 'Ready' }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READY_POLL_MS);
    });
    expect(screen.getByText('Model Widget is ready on site-b')).toBeInTheDocument();
    // The refetch the watch asked for settles (the watch has ended: no poll of its own is left).
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText('site-b ready')).toBeInTheDocument();
    expect(listCalls).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
