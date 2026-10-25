import { useState } from 'react';
import { Dropdown, DropdownItem, DropdownList, MenuToggle } from '@patternfly/react-core';
import { UserIcon } from '@patternfly/react-icons';
import { ServiceError } from '../api/ConsoleService';
import type { User } from '../api/types';

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
};

/** The masthead's user menu (PatternFly masthead pattern): who is signed in, About, and Log out. */
export const UserMenu: React.FC<Props> = ({ user, loaded, error, canSignOut, onAbout }) => {
  const [isOpen, setIsOpen] = useState(false);
  // Only a 401 means nobody is signed in; any other failure is the console failing to say who is.
  const who = error
    ? error instanceof ServiceError && error.isUnauthenticated
      ? 'Not signed in'
      : 'User could not be loaded'
    : !loaded
      ? 'Signing in...'
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
          aria-label={`User menu: ${name}`}
          isExpanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          {/* A phone shows the icon only, so the console's name keeps the room it needs. */}
          <span data-testid="masthead-user" className="pf-v6-u-display-none pf-v6-u-display-inline-on-md">
            {name}
          </span>
        </MenuToggle>
      )}
    >
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
