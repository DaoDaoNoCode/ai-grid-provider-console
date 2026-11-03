// The notification center when the signed-in user changes in the same tab: the previous user's
// notifications and watches go, and the new user's are restored.
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { BackendProvider } from '../api/connect/BackendProvider';
import { fakeClients } from '../api/connect/testing';
import { memoryStorage } from '../__tests__/memoryStorage';
import { deferred } from '../__tests__/render';
import { BackgroundWritesProvider } from './BackgroundWritesProvider';
import { NotificationsProvider } from './NotificationsProvider';
import { notificationsKey, watchesKey } from './storageKeys';
import { NotificationWatcherProvider } from './NotificationWatcherProvider';
import { useBackgroundWrites, type BackgroundWritesValue } from './useBackgroundWrites';
import { useNotifications } from './useNotifications';

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
