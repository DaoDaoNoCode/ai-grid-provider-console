import type { ReactNode } from 'react';
import { Alert, AlertActionLink } from '@patternfly/react-core';

type Props = {
  /** What failed to load: "clusters". */
  object: string;
  error: Error;
  onRetry: () => void;
  /** What the page shows without it, one sentence: "Site and Region show a dash until ...". */
  children: ReactNode;
};

/**
 * Data a page shows beside its own (the clusters' sites on the Models pages) that failed to load
 * before any of it arrived: the page's own content stays, under a warning that names what is
 * missing, with the server's message and Retry. Once some of it has loaded, a failed reload is a
 * StaleDataAlert instead.
 */
export const LoadFailedAlert: React.FC<Props> = ({ object, error, onRetry, children }) => (
  <Alert
    isInline
    variant="warning"
    title={`Unable to load ${object}`}
    actionLinks={<AlertActionLink onClick={onRetry}>Retry</AlertActionLink>}
  >
    <p>{children}</p>
    <p>{error.message}</p>
  </Alert>
);
