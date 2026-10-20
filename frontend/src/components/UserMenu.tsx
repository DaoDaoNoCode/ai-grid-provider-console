import { useState } from 'react';
import { Dropdown, DropdownItem, DropdownList, MenuToggle } from '@patternfly/react-core';
import type { User } from '../api/types';

/** Where kube-auth-proxy (oauth2-proxy) ends the session and starts a new login. */
export const SIGN_OUT_URL = '/oauth2/sign_out';

type Props = {
  user?: User;
  loaded: boolean;
  error?: Error;
  /** Offer Log out; off on the fake backend, where no login proxy runs. On while the config
   * loads or if it fails, so a signed-in user can always leave. */
  canSignOut: boolean;
  /** Opens the About dialog. */
  onAbout: () => void;
};

/** The masthead's user menu (PatternFly masthead pattern): who is signed in, About, and Log out. */
export const UserMenu: React.FC<Props> = ({ user, loaded, error, canSignOut, onAbout }) => {
  const [isOpen, setIsOpen] = useState(false);
  const name = error ? 'Not signed in' : !loaded ? 'Signing in...' : user?.username;
  const label = (
    <span data-testid="masthead-user">
      {name}
      {user?.isProviderAdmin ? ' (provider admin)' : ''}
    </span>
  );
  if (!user) {
    return label;
  }
  return (
    <Dropdown
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      popperProps={{ position: 'right' }}
      toggle={(toggleRef) => (
        <MenuToggle ref={toggleRef} variant="plainText" isExpanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
          {label}
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
