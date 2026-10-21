import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
} from '@patternfly/react-core';
import { PathMissingIcon } from '@patternfly/react-icons';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** An unknown route: PatternFly's full-page empty state with a way back. */
export const NotFoundPage: React.FC = () => {
  useDocumentTitle('Page not found');
  return (
    <PageSection isFilled>
      <EmptyState titleText="Page not found" headingLevel="h1" icon={PathMissingIcon}>
        <EmptyStateBody>
          The page you asked for doesn't exist. Check the address, or go back to the clusters.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="primary" component={(props) => <Link {...props} to="/clusters" />}>
              Go to Clusters
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    </PageSection>
  );
};
