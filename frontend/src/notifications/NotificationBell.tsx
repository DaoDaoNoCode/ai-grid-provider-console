import { NotificationBadge } from '@patternfly/react-core';
import { useNotifications } from './useNotifications';

/**
 * The masthead's bell (PatternFly's notification badge): the unread count, in the attention style
 * while an unread notification is an error. It opens and closes the notification drawer.
 */
export const NotificationBell: React.FC<{ isExpanded: boolean; onToggle: () => void }> = ({ isExpanded, onToggle }) => {
  const { notifications, unreadCount } = useNotifications();
  const attention = notifications.some((n) => !n.read && n.variant === 'danger');
  return (
    <NotificationBadge
      variant={attention ? 'attention' : unreadCount > 0 ? 'unread' : 'read'}
      count={unreadCount}
      isExpanded={isExpanded}
      onClick={onToggle}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
    />
  );
};
