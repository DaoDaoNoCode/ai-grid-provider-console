import { Alert, AlertActionLink, PageSection } from '@patternfly/react-core';
import { useLocation } from 'react-router-dom';
import { useConsoleSession } from '../context/useConsoleSession';
import { SIGN_OUT_URL } from './UserMenu';

/**
 * Shown above every page once a call answers 401. Retrying would send the same rejected token, and
 * so would a reload: the login proxy (kube-auth-proxy) keeps its session cookie and passes the
 * same token on. Log in again goes to the proxy's sign-out instead, which clears that cookie
 * (and deletes the OpenShift OAuth token) and then redirects to `rd`, a same-origin path it
 * checks (oauth2-proxy's SignOut and GetRedirect), so the next request starts a new OpenShift
 * login and lands back on this page. The fake backend has no proxy, so there it reloads.
 */
export const SessionEndedAlert: React.FC = () => {
  const { config } = useConsoleSession();
  const { pathname, search, hash } = useLocation();
  const logInAgain = () => {
    if (config?.fakeBackend) {
      window.location.reload();
      return;
    }
    window.location.assign(`${SIGN_OUT_URL}?rd=${encodeURIComponent(pathname + search + hash)}`);
  };
  return (
    <PageSection>
      <Alert
        isInline
        variant="warning"
        title="Your session has ended"
        data-testid="session-ended-alert"
        actionLinks={<AlertActionLink onClick={logInAgain}>Log in again</AlertActionLink>}
      >
        The console can't load or save anything until you log in again. Changes you haven't saved are lost when you do.
      </Alert>
    </PageSection>
  );
};
