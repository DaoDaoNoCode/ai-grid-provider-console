import { Alert, AlertActionLink } from '@patternfly/react-core';

type Props = {
  /** What is on screen: "clusters", "model". */
  object: string;
  error: Error;
  onRetry: () => void;
};

/**
 * A reload that failed while the last answer is still on screen: the data stays, under a warning
 * that says it may be out of date, with the server's message and Retry.
 */
export const StaleDataAlert: React.FC<Props> = ({ object, error, onRetry }) => (
  <Alert
    isInline
    variant="warning"
    title={`Showing the last loaded ${object}`}
    actionLinks={<AlertActionLink onClick={onRetry}>Retry</AlertActionLink>}
    data-testid="stale-data-alert"
  >
    {error.message}
  </Alert>
);
