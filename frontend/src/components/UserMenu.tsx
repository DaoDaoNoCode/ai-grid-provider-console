import { useState } from 'react';
import {
  Badge,
  Divider,
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownList,
  MenuToggle,
} from '@patternfly/react-core';
import { UserIcon } from '@patternfly/react-icons';
import { ServiceError } from '../api/ConsoleService';
import type { User } from '../api/types';
import { useTheme } from '../context/useTheme';
import type { ThemeChoice } from '../utilities/theme';
import { useNotifications } from '../notifications/useNotifications';

const themes: { choice: ThemeChoice; label: string }[] = [
  { choice: 'light', label: 'Light' },
  { choice: 'dark', label: 'Dark' },
  { choice: 'system', label: 'System' },
];

/** Where kube-auth-proxy (oauth2-proxy) ends the session and starts a new login. */
export const SIGN_OUT_URL = '/oauth2/sign_out';

type Props = {
  user?: User;
  loaded: boolean;
  error?: Error;
  /** Offer Log out; off on the fake backend, where no login proxy runs. On while the config
   * loads or if it fails, so a user can always leave. */
  canSignOut: boolean;
  /** Opens the About dialog. */
  onAbout: () => void;
  /** Opens the notification drawer; a phone reaches it here, where the masthead has no room for its bell. */
  onNotifications?: () => void;
};

/**
 * The masthead's user menu (PatternFly masthead pattern): who is signed in, About, and Log out. On a
 * phone it also offers the notifications and the theme, which the masthead's bell and toggle offer on
 * wider screens.
 */
export const UserMenu: React.FC<Props> = ({ user, loaded, error, canSignOut, onAbout, onNotifications }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { unreadCount } = useNotifications();
  // Only where the menu offers the notifications (not on a full-page state).
  const unread = onNotifications ? unreadCount : 0;
  const { choice, setChoice } = useTheme();
  // Only a 401 means nobody is signed in; any other failure is the console failing to say who is.
  const who = error
    ? error instanceof ServiceError && error.isUnauthenticated
      ? 'Not logged in'
      : 'Unable to load user'
    : !loaded
      ? 'Logging in'
      : user?.username;
  const name = `${who}${user?.isProviderAdmin ? ' (provider admin)' : ''}`;
  // A menu even while signing in or when /user fails: About, with the versions a bug report
  // needs, matters most then. Log out too: the login proxy holds a session whether or not /user
  // answered, and logging out is how to end it or sign in as someone else.
  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      popperProps={{ position: 'right' }}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          variant="plainText"
          icon={<UserIcon />}
          aria-label={`User menu: ${name}${unread > 0 ? `, ${unread} unread notifications` : ''}`}
          isExpanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          // On a phone, where the masthead has no room for the bell, the toggle shows the unread count
          // (PatternFly's badge in a menu toggle); from md up the bell shows it.
          badge={
            unread > 0 ? (
              <Badge isRead={false} screenReaderText="unread notifications" className="pf-v6-u-display-none-on-md">
                {unread}
              </Badge>
            ) : undefined
          }
        >
          {/* A phone shows the icon only, so the console's name keeps the room it needs. */}
          <span data-testid="masthead-user" className="pf-v6-u-display-none pf-v6-u-display-inline-on-md">
            {name}
          </span>
        </MenuToggle>
      )}
    >
      {onNotifications && (
        <>
          <DropdownList className="pf-v6-u-display-none-on-md">
            <DropdownItem
              key="notifications"
              description={unreadCount > 0 ? `${unreadCount} unread` : undefined}
              onClick={() => {
                setIsOpen(false);
                onNotifications();
              }}
            >
              Notifications
            </DropdownItem>
          </DropdownList>
          <Divider className="pf-v6-u-display-none-on-md" />
        </>
      )}
      <DropdownGroup label="Theme" className="pf-v6-u-display-none-on-md">
        <DropdownList>
          {themes.map((t) => (
            <DropdownItem
              key={t.choice}
              isSelected={choice === t.choice}
              onClick={() => {
                setIsOpen(false);
                setChoice(t.choice);
              }}
            >
              {t.label}
            </DropdownItem>
          ))}
        </DropdownList>
      </DropdownGroup>
      <Divider className="pf-v6-u-display-none-on-md" />
      <DropdownList>
        <DropdownItem
          key="about"
          onClick={() => {
            setIsOpen(false);
            onAbout();
          }}
        >
          About
        </DropdownItem>
        {canSignOut && (
          <DropdownItem key="sign-out" to={SIGN_OUT_URL}>
            Log out
          </DropdownItem>
        )}
      </DropdownList>
    </Dropdown>
  );
};
