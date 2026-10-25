import { Alert, AlertActionLink, EmptyState, EmptyStateBody } from '@patternfly/react-core';
import { ServiceError } from '../api/ConsoleService';

type Props = {
  /** What was being loaded, e.g. "Clusters". */
  subject: string;
  error: Error;
  /** The not-available title when "<subject> are ..." doesn't read, e.g. "AI Grid is not available ...". */
  notAvailableTitle?: string;
  /** The error's title; "<subject> could not be loaded" without one. */
  title?: string;
  /** Offers Retry on the error. */
  onRetry?: () => void;
};

/**
 * Renders a failed load. A 501 from the BFF means the backend does not
 * implement the RPC behind this page yet; that is an expected state while the
 * backend and the console are developed in parallel, so it is shown as an
 * informational empty state rather than an error. A 401 shows nothing: the
 * console says once, above every page, that the session has ended, and a retry
 * would send the same rejected token. Everything else is an error with the
 * BFF's message.
 */
export const LoadError: React.FC<Props> = ({ subject, error, notAvailableTitle, title, onRetry }) => {
  if (error instanceof ServiceError && error.isUnauthenticated) {
    return null;
  }
  if (error instanceof ServiceError && error.isNotImplemented) {
    return (
      <EmptyState
        titleText={notAvailableTitle ?? `${subject} are not available on this backend yet`}
        headingLevel="h3"
        variant="sm"
      >
        <EmptyStateBody>
          The AI Grid backend this console talks to does not implement this capability yet. The page will work without
          changes once it does.
        </EmptyStateBody>
      </EmptyState>
    );
  }
  return (
    <Alert
      variant="danger"
      isInline
      title={title ?? `${subject} could not be loaded`}
      actionLinks={onRetry && <AlertActionLink onClick={onRetry}>Retry</AlertActionLink>}
    >
      {error.message}
    </Alert>
  );
};
