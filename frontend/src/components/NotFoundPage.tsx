import { PageSection } from '@patternfly/react-core';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { NotFoundState } from './states/NotFoundState';

/** An unknown route: the not-found state, as the page's only heading, with a way back. */
export const NotFoundPage: React.FC = () => {
  useDocumentTitle('Page not found');
  return (
    <PageSection isFilled>
      <NotFoundState
        what="Page"
        headingLevel="h1"
        body="The page you asked for doesn't exist. Check the address, or go back to the clusters."
        listPath="/clusters"
        listLabel="Clusters"
      />
    </PageSection>
  );
};
