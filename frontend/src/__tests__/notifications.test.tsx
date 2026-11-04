// The notification center's bell, drawer and toasts in the console, with a session storage of the
// test's own.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MockConsoleService } from '../api/MockConsoleService';
import { notificationsKey } from '../notifications/storageKeys';

/** The tab's storage key of the signed-in user, MockConsoleService's dev-user. */
const NOTIFICATIONS_KEY = notificationsKey('dev-user');
import type { ConsoleNotification } from '../notifications/useNotifications';
import type { GetStorage } from '../utilities/signInAgain';
import { blockedStorage, memoryStorage } from './memoryStorage';
import { TestApp } from './TestApp';

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

const stored: ConsoleNotification[] = [
  {
    id: 'n3',
    variant: 'danger',
    title: 'Unable to deploy model Widget',
    message: 'Image pull failed.',
    actions: [{ title: 'View model', to: '/models/widget' }],
    timestamp: minutesAgo(1),
    read: false,
  },
  { id: 'n2', variant: 'success', title: 'Model Gadget deployed', timestamp: minutesAgo(5), read: false },
  { id: 'n1', variant: 'info', title: 'Deploying model Gadget', timestamp: minutesAgo(6), read: true },
];

const renderConsole = (path: string, storage: GetStorage) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TestApp service={new MockConsoleService()} storage={storage} />
    </MemoryRouter>,
  );

const drawer = () => screen.getByRole('list', { name: 'Notifications' });

it('shows the unread count on the bell and lists the notifications newest first in the drawer', async () => {
  const user = userEvent.setup();
  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify(stored) }).get);
  const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
  expect(bell).toHaveAttribute('aria-expanded', 'false');
  await user.click(bell);
  expect(bell).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByText('2 unread')).toBeVisible();
  const items = within(drawer()).getAllByRole('listitem');
  expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
    'Danger notification:Unable to deploy model Widget',
    'Success notification:Model Gadget deployed',
    'Info notification:Deploying model Gadget',
  ]);
  expect(items[0]).toHaveTextContent('Image pull failed.');
  expect(items[0]).toHaveTextContent('1 minute ago');
  expect(items[2]).toHaveClass('pf-m-read');
});

it('marks a notification read when it is clicked, and follows its link', async () => {
  const user = userEvent.setup();
  const storage = memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify(stored) });
  renderConsole('/clusters', storage.get);
  await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
  const first = within(drawer()).getAllByRole('listitem')[0];
  await user.click(within(first).getByText('Image pull failed.'));
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  expect(first).toHaveClass('pf-m-read');
  // Kept in the tab's session storage.
  const kept = JSON.parse(storage.values.get(NOTIFICATIONS_KEY)!) as ConsoleNotification[];
  expect(kept.find((n) => n.id === 'n3')?.read).toBe(true);

  await user.click(within(first).getByRole('button', { name: 'View model' }));
  expect(await screen.findByText('Model not found')).toBeVisible();
  // The drawer closes, so the page it opened is in view.
  expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toHaveAttribute('aria-expanded', 'false');
});

it('marks all read, removes one, and clears all from the drawer', async () => {
  const user = userEvent.setup();
  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify(stored) }).get);
  await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
  await user.click(screen.getByRole('button', { name: 'Notification actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Mark all read' }));
  expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Remove notification: Model Gadget deployed' }));
  expect(within(drawer()).getAllByRole('listitem')).toHaveLength(2);

  await user.click(screen.getByRole('button', { name: 'Notification actions' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Clear all' }));
  expect(await screen.findByRole('heading', { name: 'No notifications' })).toBeVisible();
  expect(screen.getByText('Notifications for the changes you make in this browser tab appear here.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close notifications' }));
  expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-expanded', 'false');
});

it("shows the unread count on the user menu's toggle, where a phone has no bell", async () => {
  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify(stored) }).get);
  const toggle = await screen.findByRole('button', { name: /^User menu/ });
  // PatternFly's badge in the toggle, shown below the md breakpoint only, where the bell is hidden.
  const count = await within(toggle).findByText('2');
  expect(count.closest('.pf-v6-c-badge')).toHaveClass('pf-m-unread', 'pf-v6-u-display-none-on-md');
  expect(within(toggle).getByText('unread notifications')).toBeInTheDocument();
});

it('opens the drawer from the user menu, where a phone finds it, with the unread count', async () => {
  const user = userEvent.setup();
  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify(stored) }).get);
  await user.click(await screen.findByRole('button', { name: /^User menu/ }));
  // Shown below PatternFly's md breakpoint only (pf-v6-u-display-none-on-md), as the theme choice is.
  const item = await screen.findByRole('menuitem', { name: /^Notifications/ });
  expect(item).toHaveTextContent('2 unread');
  expect(item.closest('ul')).toHaveClass('pf-v6-u-display-none-on-md');
  await user.click(item);
  expect(
    await screen.findByText('2 unread', { selector: '.pf-v6-c-notification-drawer__header-status' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toHaveAttribute('aria-expanded', 'true');
});

it("keeps a page's success notice in the drawer as read, beside the center's notifications", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/clusters', state: { notice: 'Organization created' } }]}>
      <TestApp service={new MockConsoleService()} storage={memoryStorage().get} />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Organization created')).toBeVisible();
  // Read: the user saw it, in answer to their own click.
  await user.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(within(drawer()).getByRole('listitem')).toHaveClass('pf-m-read');
});

it('works without session storage, and forgets on reload', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/clusters', state: { notice: 'Organization created' } }]}>
      <TestApp service={new MockConsoleService()} storage={blockedStorage} />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Organization created')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Notifications' }));
  await waitFor(() => expect(within(drawer()).getAllByRole('listitem')).toHaveLength(1));
});

it('restores only well-formed notifications: a message, links and a time that make sense', async () => {
  const user = userEvent.setup();
  const valid = stored[2];
  const malformed = [
    { ...valid, id: 'm1', message: 42 },
    { ...valid, id: 'm2', actions: 'View model' },
    { ...valid, id: 'm3', actions: [{ title: 'View model' }] },
    { ...valid, id: 'm4', actions: [{ title: 'Away', to: 'https://example.com/elsewhere' }] },
    { ...valid, id: 'm5', timestamp: 1e20 },
    { ...valid, id: 'm6', timestamp: -1 },
    { ...valid, id: 'm7', title: '' },
  ];
  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: JSON.stringify([...malformed, valid]) }).get);
  await user.click(await screen.findByRole('button', { name: 'Notifications' }));
  const items = within(drawer()).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent('Deploying model Gadget');
});

it("shows only the signed-in user's notifications in a tab another user used", async () => {
  const user = userEvent.setup();
  renderConsole(
    '/clusters',
    memoryStorage({
      [notificationsKey('alice')]: JSON.stringify([stored[0]]),
      [NOTIFICATIONS_KEY]: JSON.stringify([stored[1]]),
    }).get,
  );
  await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
  const items = within(drawer()).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent('Model Gadget deployed');
});

it('ignores what it cannot read in storage', async () => {
  const user = userEvent.setup();
  const garbage = JSON.stringify([{ id: 1 }, 'x', { ...stored[1], variant: 'sparkly' }, stored[2]]);
  const { unmount } = renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: garbage }).get);
  await user.click(await screen.findByRole('button', { name: 'Notifications' }));
  expect(within(drawer()).getAllByRole('listitem')).toHaveLength(1);
  unmount();

  renderConsole('/clusters', memoryStorage({ [NOTIFICATIONS_KEY]: '{not json' }).get);
  await user.click(await screen.findByRole('button', { name: 'Notifications' }));
  expect(await screen.findByRole('heading', { name: 'No notifications' })).toBeVisible();
});
