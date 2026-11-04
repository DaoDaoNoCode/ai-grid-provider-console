// Adapted from opendatahub-io/odh-dashboard packages/ui-core/src/contexts/NotificationWatcherContext.tsx
// at 1e2cc01e1c33c27a1b4b87ca3305a1d34b084982. Changes: string ids; SUCCESS and ERROR go to the
// console's notification center (unread, as they arrive while the user may be elsewhere), WARNING
// as a warning, each replacing the item's notificationId when it has one; a
// callback that throws stops its watch instead of logging; a REPOLL's timer is cleared on
// unregister as well as on unmount.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNotifications } from './useNotifications';
import {
  NotificationResponseStatus,
  NotificationWatcherContext,
  type NotificationWatcherItem,
} from './useNotificationWatcher';

const DEFAULT_POLL_INTERVAL = 30_000;

const variants = {
  [NotificationResponseStatus.SUCCESS]: 'success',
  [NotificationResponseStatus.ERROR]: 'danger',
  [NotificationResponseStatus.WARNING]: 'warning',
} as const;

type Props = {
  children: React.ReactNode;
  pollInterval?: number;
};

export const NotificationWatcherProvider: React.FC<Props> = ({ children, pollInterval = DEFAULT_POLL_INTERVAL }) => {
  const { notify } = useNotifications();
  const controllers = useRef(new Map<NotificationWatcherItem, AbortController>());
  const timeouts = useRef(new Map<NotificationWatcherItem, ReturnType<typeof setTimeout>>());

  const invoke = useCallback(
    (item: NotificationWatcherItem, signal: AbortSignal) => {
      const delay = item.callbackDelay ?? pollInterval;
      const check = () =>
        item
          .callback(signal)
          .catch(() => ({ status: NotificationResponseStatus.STOP }) as const)
          .then((response) => {
            if (response.status !== NotificationResponseStatus.REPOLL) {
              controllers.current.delete(item);
            }
            if (signal.aborted) {
              return;
            }
            switch (response.status) {
              case NotificationResponseStatus.SUCCESS:
              case NotificationResponseStatus.ERROR:
              case NotificationResponseStatus.WARNING:
                notify({
                  id: item.notificationId,
                  variant: variants[response.status],
                  title: response.title,
                  message: response.message,
                  actions: response.actions,
                });
                break;
              case NotificationResponseStatus.REPOLL:
                timeouts.current.set(
                  item,
                  setTimeout(() => {
                    timeouts.current.delete(item);
                    check();
                  }, delay),
                );
                break;
              case NotificationResponseStatus.STOP:
                break;
              default: {
                // A new status that isn't handled above fails to compile here.
                const unhandled: never = response;
                return unhandled;
              }
            }
          });
      check();
    },
    [notify, pollInterval],
  );

  useEffect(() => {
    const pending = timeouts.current;
    const running = controllers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
      running.forEach((controller) => controller.abort());
      running.clear();
    };
  }, []);

  const registerNotification = useCallback(
    (item: NotificationWatcherItem) => {
      const controller = new AbortController();
      controllers.current.set(item, controller);
      invoke(item, controller.signal);
    },
    [invoke],
  );

  const unregisterNotification = useCallback((id: string) => {
    timeouts.current.forEach((timeout, item) => {
      if (item.id === id) {
        clearTimeout(timeout);
        timeouts.current.delete(item);
      }
    });
    controllers.current.forEach((controller, item) => {
      if (item.id === id) {
        controller.abort();
        controllers.current.delete(item);
      }
    });
  }, []);

  const value = useMemo(
    () => ({ registerNotification, unregisterNotification }),
    [registerNotification, unregisterNotification],
  );
  return <NotificationWatcherContext.Provider value={value}>{children}</NotificationWatcherContext.Provider>;
};
