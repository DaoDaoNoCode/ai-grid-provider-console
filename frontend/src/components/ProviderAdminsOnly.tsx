import { EmptyState, EmptyStateBody, PageSection } from '@patternfly/react-core';
import { LockIcon } from '@patternfly/react-icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * What a signed-in user who is not a provider admin sees instead of the pages: the BFF answers
 * them 403 on everything but /user and /config (docs/plan/bff-api.md, Identity), so every page
 * would only show an error.
 */
export const ProviderAdminsOnly: React.FC<{ username: string }> = ({ username }) => {
  useDocumentTitle('Provider admins only');
  return (
    <PageSection isFilled>
      <EmptyState titleText="This console is for provider admins" headingLevel="h1" icon={LockIcon}>
        <EmptyStateBody>
          You are signed in as {username}, who is not a provider admin on this hub. A provider admin can change managed
          clusters on the hub; ask a hub administrator for that access, then reload the page, or log out and sign in as
          someone else.
        </EmptyStateBody>
      </EmptyState>
    </PageSection>
  );
};
