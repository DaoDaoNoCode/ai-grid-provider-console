// How long each toast stays: success and info (as the page's notices) time out as PatternFly's toasts do; an error or a
// warning stays until the user closes it, so nobody misses a write that failed or can't be confirmed.
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { memoryStorage } from '../__tests__/memoryStorage';
import { NotificationsProvider } from './NotificationsProvider';
import { NotificationToasts } from './NotificationToasts';
import { useNotifications } from './useNotifications';

const Raise: React.FC = () => {
  const { notify } = useNotifications();
  useEffect(() => {
    notify({ variant: 'success', title: 'Model Widget deployed' });
    notify({ variant: 'danger', title: 'Unable to deploy model Gizmo' });
  }, [notify]);
  return null;
};

const RaiseWarning: React.FC = () => {
  const { notify } = useNotifications();
  useEffect(() => {
    notify({ variant: 'warning', title: 'Unable to confirm model Widget' });
  }, [notify]);
  return null;
};

const title = (name: string) => screen.queryByRole('heading', { name: new RegExp(`alert: ${name}$`) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('times a success toast out, and keeps an error or a warning until it is closed', async () => {
  render(
    <MemoryRouter>
      <NotificationsProvider storage={memoryStorage().get} owner="dev-user">
        <Raise />
        <RaiseWarning />
        <NotificationToasts onViewAll={() => undefined} />
      </NotificationsProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(title('Model Widget deployed')).toBeInTheDocument();
  expect(title('Unable to deploy model Gizmo')).toBeInTheDocument();
  // PatternFly's 8 seconds, then its 3-second fade, and far beyond.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(title('Model Widget deployed')).not.toBeInTheDocument();
  expect(title('Unable to deploy model Gizmo')).toBeInTheDocument();
  expect(title('Unable to confirm model Widget')).toBeInTheDocument();
});
