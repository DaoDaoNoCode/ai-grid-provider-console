import { useEffect } from 'react';
import { Alert, AlertActionCloseButton, AlertActionLink, AlertGroup } from '@patternfly/react-core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useNotifications, type ConsoleNotification } from './useNotifications';

/** PatternFly's toast group shows a few and offers the rest in the notification drawer. */
export const MAX_TOASTS = 3;

/**
 * Every toast the console shows, one look for all (PatternFly's toast alert group): a page's own
 * success notice (NoticeToast) and the notification center's outcomes alike. Each closes when it
 * is closed, times out (PatternFly's 8 seconds, paused while the pointer or focus is on it), or,
 * for a page's notice, when the user moves on to another page. Every toast is also in the drawer.
 */
export const NotificationToasts: React.FC<{ onViewAll: () => void }> = ({ onViewAll }) => {
  const { notifications, toasts, dismissToast } = useNotifications();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // A page's notice doesn't follow the user to another page.
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.page && toast.page !== pathname) dismissToast(toast.id);
    }
  }, [toasts, pathname, dismissToast]);

  const shown = toasts
    .filter((t) => !t.page || t.page === pathname)
    .map((t) => notifications.find((n) => n.id === t.id))
    .filter((n): n is ConsoleNotification => n !== undefined);
  const visible = shown.slice(-MAX_TOASTS);
  const more = shown.length - visible.length;

  return (
    <AlertGroup
      isToast
      isLiveRegion
      overflowMessage={more > 0 ? `View ${more} more ${more === 1 ? 'notification' : 'notifications'}` : ''}
      onOverflowClick={onViewAll}
    >
      {visible.map((n) => (
        <Alert
          key={n.id}
          variant={n.variant}
          title={n.title}
          // An error or a warning stays until it is closed: a failed or unconfirmed write mustn't pass
          // unnoticed. A success or an info toast times out as PatternFly's do.
          timeout={n.variant === 'success' || n.variant === 'info'}
          onTimeout={() => dismissToast(n.id)}
          actionClose={<AlertActionCloseButton title={n.title} onClose={() => dismissToast(n.id)} />}
          actionLinks={n.actions?.map((action) => (
            <AlertActionLink
              key={action.to}
              onClick={() => {
                dismissToast(n.id);
                void navigate(action.to);
              }}
            >
              {action.title}
            </AlertActionLink>
          ))}
        >
          {n.message}
        </Alert>
      ))}
    </AlertGroup>
  );
};
