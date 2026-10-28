import { Button, EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from '@patternfly/react-core';
import { SearchIcon } from '@patternfly/react-icons';

type Props = {
  /** What to change, e.g. "Change the filter to see more clusters." */
  body: string;
  /** Clears the search or filters; without it there is no action. */
  onClear?: () => void;
};

/** A search or filter that matches nothing: PatternFly's small empty state with the search icon. */
export const NoResultsState: React.FC<Props> = ({ body, onClear }) => (
  <EmptyState variant="xs" headingLevel="h3" titleText="No results found" icon={SearchIcon}>
    <EmptyStateBody>{body}</EmptyStateBody>
    {onClear && (
      <EmptyStateFooter>
        <EmptyStateActions>
          <Button variant="link" onClick={onClear}>
            Clear all filters
          </Button>
        </EmptyStateActions>
      </EmptyStateFooter>
    )}
  </EmptyState>
);
