// The notification center's context and hook, in their own module so NotificationsProvider.tsx
// exports only the provider (as useTheme.ts does for the theme).
import { createContext, useContext } from 'react';

export type NotificationVariant = 'success' | 'danger' | 'warning' | 'info';

/** A link a notification offers, such as "Edit model": a path in the console. */
export type NotificationLink = { title: string; to: string };

/** One entry of the notification drawer; the toasts show the newest ones too. */
export type ConsoleNotification = {
  id: string;
  variant: NotificationVariant;
  title: string;
  message?: string;
  actions?: NotificationLink[];
  /** When it was raised, in milliseconds since the epoch. */
  timestamp: number;
  read: boolean;
};

export type NotifyInput = {
  /**
   * The entry this one replaces, such as the in-progress entry of the write it reports: one entry
   * per write, at the top again. A new id when left out.
   */
  id?: string;
  variant: NotificationVariant;
  title: string;
  message?: string;
  actions?: NotificationLink[];
  /**
   * The answer to the user's own click, shown while they look at it (a saved form's success, a
   * slow save handed to the center): kept in the drawer as read. Anything that arrives later is
   * unread until the user opens it.
   */
  read?: boolean;
  /** The page the toast belongs to: it closes when the user moves on to another page. */
  page?: string;
};

/** A toast on screen: a notification, until it is closed or times out. */
export type Toast = { id: string; page?: string };

export type NotificationsContextValue = {
  /** Newest first. */
  notifications: ConsoleNotification[];
  unreadCount: number;
  /** Oldest first, as PatternFly's toast group stacks them. */
  toasts: Toast[];
  notify: (input: NotifyInput) => string;
  dismissToast: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
};

const noop = () => undefined;

export const NotificationsContext = createContext<NotificationsContextValue>({
  notifications: [],
  unreadCount: 0,
  toasts: [],
  notify: () => '',
  dismissToast: noop,
  markRead: noop,
  markAllRead: noop,
  remove: noop,
  clearAll: noop,
});

/** The console's notification center: toasts, and the drawer's list. */
export const useNotifications = () => useContext(NotificationsContext);
