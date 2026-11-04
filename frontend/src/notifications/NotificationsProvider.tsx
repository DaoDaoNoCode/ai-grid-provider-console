// The notification list odh-dashboard's drawer reads (an id, a status, a title, a message,
// actions, a timestamp and read; marked read and removed one by one), from
// opendatahub-io/odh-dashboard frontend/src/app/AppNotificationDrawer.tsx at
// 1e2cc01e1c33c27a1b4b87ca3305a1d34b084982, as a React context kept in the tab's session storage.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GetStorage } from '../utilities/signInAgain';
import { isObject, readRecords, removeRecords, writeRecords } from './sessionRecords';
import { notificationsKey } from './storageKeys';
import {
  type ConsoleNotification,
  type NotificationsContextValue,
  type NotifyInput,
  type Toast,
  NotificationsContext,
} from './useNotifications';

/** The drawer keeps the newest ones; older ones drop off. */
export const MAX_NOTIFICATIONS = 50;

const variants = new Set(['success', 'danger', 'warning', 'info']);
/** A restored timestamp is after the console existed and not in the future (a day of clock skew). */
const EARLIEST = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60_000;

const isLink = (value: unknown) =>
  isObject(value) &&
  typeof value.title === 'string' &&
  value.title !== '' &&
  typeof value.to === 'string' &&
  // A path in the console: never another origin, nor a protocol-relative URL.
  value.to.startsWith('/') &&
  !value.to.startsWith('//');

/** Only an entry in the shape the console writes is restored; anything else is dropped. */
const isNotification =
  (now: number) =>
  (value: unknown): value is ConsoleNotification =>
    isObject(value) &&
    typeof value.id === 'string' &&
    value.id !== '' &&
    typeof value.title === 'string' &&
    value.title !== '' &&
    (value.message === undefined || typeof value.message === 'string') &&
    (value.actions === undefined || (Array.isArray(value.actions) && value.actions.every(isLink))) &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    value.timestamp >= EARLIEST &&
    value.timestamp <= now + DAY_MS &&
    typeof value.read === 'boolean' &&
    variants.has(value.variant as string);

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

type Props = {
  children: React.ReactNode;
  /** The tab's session storage; a test gives its own. */
  storage: GetStorage;
  /**
   * The signed-in user, whose notifications these are: none are read or kept until it is known,
   * and when it changes the previous user's leave the tab.
   */
  owner?: string;
  /** For tests. */
  now?: () => number;
};

export const NotificationsProvider: React.FC<Props> = ({ children, storage, owner, now = Date.now }) => {
  const [notifications, setNotifications] = useState<ConsoleNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The user whose list this is. A first user takes on what was raised before it was known; another
  // user replaces the list, and the previous user's stored one is removed.
  const [loadedFor, setLoadedFor] = useState<string>();
  if (owner !== undefined && owner !== loadedFor) {
    const restored = readRecords(storage, notificationsKey(owner), isNotification(now()));
    setLoadedFor(owner);
    if (loadedFor === undefined) {
      setNotifications((prev) => [...prev, ...restored.filter((r) => !prev.some((n) => n.id === r.id))]);
    } else {
      setNotifications(restored);
      setToasts([]);
    }
  }
  const previous = useRef<string>(undefined);
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== loadedFor) {
      removeRecords(storage, notificationsKey(previous.current));
    }
    previous.current = loadedFor;
  }, [storage, loadedFor]);
  useEffect(() => {
    if (loadedFor !== undefined) writeRecords(storage, notificationsKey(loadedFor), notifications);
  }, [storage, loadedFor, notifications]);

  const notify = useCallback(
    ({ id: replaces, variant, title, message, actions, read = false, page }: NotifyInput) => {
      const id = replaces ?? newId();
      const entry: ConsoleNotification = {
        id,
        variant,
        title,
        ...(message ? { message } : {}),
        ...(actions?.length ? { actions } : {}),
        timestamp: now(),
        read,
      };
      // An entry with the same id (a write's in-progress entry) is replaced, newest first again.
      setNotifications((prev) => [entry, ...prev.filter((n) => n.id !== id)].slice(0, MAX_NOTIFICATIONS));
      setToasts((prev) => [...prev.filter((t) => t.id !== id), page ? { id, page } : { id }]);
      return id;
    },
    [now],
  );
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const markRead = useCallback(
    (id: string) => setNotifications((prev) => prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n))),
    [],
  );
  const markAllRead = useCallback(
    () => setNotifications((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev)),
    [],
  );
  const remove = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const clearAll = useCallback(() => {
    setNotifications([]);
    setToasts([]);
  }, []);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter((n) => !n.read).length,
      toasts,
      notify,
      dismissToast,
      markRead,
      markAllRead,
      remove,
      clearAll,
    }),
    [notifications, toasts, notify, dismissToast, markRead, markAllRead, remove, clearAll],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};
