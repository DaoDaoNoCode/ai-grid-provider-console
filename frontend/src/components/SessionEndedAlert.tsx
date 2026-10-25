import { Alert, AlertActionLink, PageSection } from '@patternfly/react-core';

/**
 * Shown above every page once a call answers 401. Retrying would send the same rejected token;
 * a reload goes through the login proxy (kube-auth-proxy), which starts a new login.
 */
export const SessionEndedAlert: React.FC = () => (
  <PageSection>
    <Alert
      isInline
      variant="warning"
      title="Your session has ended"
      data-testid="session-ended-alert"
      actionLinks={<AlertActionLink onClick={() => window.location.reload()}>Log in again</AlertActionLink>}
    >
      The console can't load or save anything until you log in again. Changes you haven't saved are lost when you do.
    </Alert>
  </PageSection>
);
