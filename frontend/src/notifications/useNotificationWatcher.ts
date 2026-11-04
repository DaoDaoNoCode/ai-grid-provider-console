// Adapted from opendatahub-io/odh-dashboard packages/ui-core/src/contexts/NotificationWatcherContext.tsx
// at 1e2cc01e1c33c27a1b4b87ca3305a1d34b084982: its types and context, in their own module so
// NotificationWatcherProvider.tsx exports only the provider. Added: WARNING, for an outcome nobody can
// confirm, and notificationId, so an outcome replaces the entry that said the write was in progress.
import { createContext, useContext } from 'react';
import type { NotificationLink } from './useNotifications';

export enum NotificationResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  STOP = 'stop',
  REPOLL = 'repoll',
  WARNING = 'warning',
}

export type FinalNotificationWatcherResponse =
  | {
      status:
        NotificationResponseStatus.SUCCESS | NotificationResponseStatus.ERROR | NotificationResponseStatus.WARNING;
      title: string;
      message?: string;
      actions?: NotificationLink[];
    }
  | { status: NotificationResponseStatus.STOP };

export type NotificationWatcherResponse =
  FinalNotificationWatcherResponse | { status: NotificationResponseStatus.REPOLL };

/** Checks once; the signal aborts when the watch is unregistered or the console unmounts. */
export type NotificationWatcherCallback = (signal: AbortSignal) => Promise<NotificationWatcherResponse>;

export type NotificationWatcherItem = {
  /** How long to wait before checking again after REPOLL; the provider's poll interval by default. */
  callbackDelay?: number;
  callback: NotificationWatcherCallback;
  /** Given to unregister the watch later. */
  id?: string;
  /** The notification the final answer replaces (the write's in-progress entry), if any. */
  notificationId?: string;
};

export type NotificationWatcherContextValue = {
  registerNotification: (item: NotificationWatcherItem) => void;
  unregisterNotification: (id: string) => void;
};

export const NotificationWatcherContext = createContext<NotificationWatcherContextValue>({
  registerNotification: () => undefined,
  unregisterNotification: () => undefined,
});

export const useNotificationWatcher = () => useContext(NotificationWatcherContext);
