// Adapted from opendatahub-io/odh-dashboard frontend/src/app/AppNotificationDrawer.tsx at
// 1e2cc01e1c33c27a1b4b87ca3305a1d34b084982, with PatternFly's notification drawer pattern: a header
// with the unread count and a menu (Mark all read, Clear all), newest first, an item marked read when
// clicked, its links, and a remove button.
import { useState } from 'react';
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  MenuToggle,
  NotificationDrawer,
  NotificationDrawerBody,
  NotificationDrawerHeader,
  NotificationDrawerList,
  NotificationDrawerListItem,
  NotificationDrawerListItemBody,
  NotificationDrawerListItemHeader,
  Stack,
} from '@patternfly/react-core';
import { EllipsisVIcon, TimesIcon } from '@patternfly/react-icons';
import { useNavigate } from 'react-router-dom';
import { RelativeTime } from '../components/RelativeTime';
import { SectionEmptyState } from '../components/states/SectionEmptyState';
import { useNotifications, type NotificationVariant } from './useNotifications';

/** What a screen reader hears before each title, as PatternFly's alerts say it. */
const variantWords: Record<NotificationVariant, string> = {
  success: 'Success notification:',
  danger: 'Danger notification:',
  warning: 'Warning notification:',
  info: 'Info notification:',
};

export const NotificationDrawerPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { notifications, unreadCount, markRead, markAllRead, remove, clearAll } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <NotificationDrawer>
      <NotificationDrawerHeader count={unreadCount} onClose={onClose} closeButtonAriaLabel="Close notifications">
        <Dropdown
          isOpen={menuOpen}
          onOpenChange={setMenuOpen}
          popperProps={{ position: 'right' }}
          toggle={(ref) => (
            <MenuToggle
              ref={ref}
              variant="plain"
              icon={<EllipsisVIcon />}
              aria-label="Notification actions"
              isExpanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            />
          )}
        >
          <DropdownList>
            <DropdownItem
              isDisabled={unreadCount === 0}
              onClick={() => {
                setMenuOpen(false);
                markAllRead();
              }}
            >
              Mark all read
            </DropdownItem>
            <DropdownItem
              isDisabled={notifications.length === 0}
              onClick={() => {
                setMenuOpen(false);
                clearAll();
              }}
            >
              Clear all
            </DropdownItem>
          </DropdownList>
        </Dropdown>
      </NotificationDrawerHeader>
      <NotificationDrawerBody>
        {notifications.length ? (
          <NotificationDrawerList aria-label="Notifications">
            {notifications.map((n) => (
              <NotificationDrawerListItem key={n.id} variant={n.variant} isRead={n.read} onClick={() => markRead(n.id)}>
                <NotificationDrawerListItemHeader variant={n.variant} title={n.title} srTitle={variantWords[n.variant]}>
                  <Button
                    variant="plain"
                    icon={<TimesIcon />}
                    aria-label={`Remove notification: ${n.title}`}
                    onClick={(event) => {
                      // Removing it isn't reading it.
                      event.stopPropagation();
                      remove(n.id);
                    }}
                  />
                </NotificationDrawerListItemHeader>
                <NotificationDrawerListItemBody timestamp={<RelativeTime time={new Date(n.timestamp).toISOString()} />}>
                  {(n.message || n.actions?.length) && (
                    <Stack hasGutter>
                      {n.message && <span>{n.message}</span>}
                      {n.actions?.length ? (
                        <Flex>
                          {n.actions.map((action) => (
                            <Button
                              key={action.to}
                              variant="link"
                              isInline
                              onClick={() => {
                                markRead(n.id);
                                onClose();
                                void navigate(action.to);
                              }}
                            >
                              {action.title}
                            </Button>
                          ))}
                        </Flex>
                      ) : null}
                    </Stack>
                  )}
                </NotificationDrawerListItemBody>
              </NotificationDrawerListItem>
            ))}
          </NotificationDrawerList>
        ) : (
          <SectionEmptyState title="No notifications" headingLevel="h2">
            Notifications for the changes you make in this browser tab appear here.
          </SectionEmptyState>
        )}
      </NotificationDrawerBody>
    </NotificationDrawer>
  );
};
