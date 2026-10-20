// Ported from krisv/ai-grid-cloud-provider-poc src/shared/dashboard.tsx (ApplicationsPage) at 62319b8.
// Adapted from opendatahub-io/odh-dashboard frontend/src/pages/ApplicationsPage.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Retry calls the page's reload instead of reloading the browser, and a 501 is the console's
// not-available state. A load error replaces the content only until the content first shows:
// the governance data polls, and a failed poll must not unmount a form with the user's input.
import { useState } from 'react';
import { Alert, AlertActionLink, PageSection, Spinner } from '@patternfly/react-core';
import { ServiceError } from '../../api/ConsoleService';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';

type Props = {
  title: string;
  description?: string;
  breadcrumb?: React.ReactElement;
  headerAction?: React.ReactNode;
  loaded: boolean;
  loadError?: Error;
  errorMessage?: string;
  onRetry: () => void;
  children?: React.ReactNode;
};

/** A subscription page: breadcrumb, title and actions, then a spinner, the error, or the content. */
export const ApplicationsPage: React.FC<Props> = ({
  title,
  description,
  breadcrumb,
  headerAction,
  loaded,
  loadError,
  errorMessage,
  onRetry,
  children,
}) => {
  const [contentShown, setContentShown] = useState(false);
  if (!contentShown && loaded && !loadError) {
    setContentShown(true);
  }
  let body: React.ReactNode = children;
  if (!contentShown && !loaded) {
    body = (
      <PageSection isFilled>
        <Spinner aria-label="Loading data" />
      </PageSection>
    );
  } else if (!contentShown && loadError instanceof ServiceError && loadError.isNotImplemented) {
    body = (
      <PageSection isFilled>
        <LoadError subject="Subscriptions" error={loadError} />
      </PageSection>
    );
  } else if (!contentShown && loadError) {
    body = (
      <PageSection isFilled>
        <Alert
          variant="danger"
          isInline
          title={errorMessage ?? 'Unable to load subscriptions'}
          actionLinks={<AlertActionLink onClick={onRetry}>Retry</AlertActionLink>}
        >
          {loadError.message}
        </Alert>
      </PageSection>
    );
  }
  return (
    <>
      <PageHeader title={title} description={description} breadcrumb={breadcrumb} headerAction={headerAction} />
      {body}
    </>
  );
};
