import { Alert, EmptyState, EmptyStateBody } from '@patternfly/react-core';
import { ServiceError } from '../api/ConsoleService';

type Props = {
  /** What was being loaded, e.g. "Clusters". */
  subject: string;
  error: Error;
  /** The not-available title when "<subject> are ..." doesn't read, e.g. "AI Grid is not available ...". */
  notAvailableTitle?: string;
};

/**
 * Renders a failed load. A 501 from the BFF means the backend does not
 * implement the RPC behind this page yet; that is an expected state while the
 * backend and the console are developed in parallel, so it is shown as an
 * informational empty state rather than an error. Everything else is an error
 * with the BFF's message.
 */
export const LoadError: React.FC<Props> = ({ subject, error, notAvailableTitle }) => {
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
    <Alert variant="danger" isInline title={`${subject} could not be loaded`}>
      {error.message}
    </Alert>
  );
};
