import {
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  type EmptyStateProps,
} from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';

type Props = {
  /** "Unable to load <object>": singular on a page for one object. */
  title: string;
  /** What went wrong, usually the server's message. */
  children?: React.ReactNode;
  onRetry: () => void;
  /** The action's label; Reload where the page itself has to be fetched again. */
  retryLabel?: string;
  headingLevel?: EmptyStateProps['headingLevel'];
  /** More in the footer, under the action (the error's details). */
  footer?: React.ReactNode;
};

/**
 * A load that failed with nothing to show instead: PatternFly's full empty state for a back-end
 * failure, in the danger status (a red exclamation), with one primary action to try again.
 */
export const ErrorState: React.FC<Props> = ({
  title,
  children,
  onRetry,
  retryLabel = 'Retry',
  headingLevel = 'h2',
  footer,
}) => (
  <EmptyState
    variant="lg"
    status="danger"
    icon={ExclamationCircleIcon}
    titleText={title}
    headingLevel={headingLevel}
    data-testid="error-state"
  >
    {children && <EmptyStateBody>{children}</EmptyStateBody>}
    <EmptyStateFooter>
      <EmptyStateActions>
        <Button variant="primary" onClick={onRetry}>
          {retryLabel}
        </Button>
      </EmptyStateActions>
      {footer}
    </EmptyStateFooter>
  </EmptyState>
);
