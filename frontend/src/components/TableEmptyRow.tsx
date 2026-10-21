import {
  Bullseye,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
} from '@patternfly/react-core';
import { SearchIcon } from '@patternfly/react-icons';
import { Td, Tr } from '@patternfly/react-table';

type Props = {
  /** The table's column count, so the row spans it. */
  colSpan: number;
  /** What to change, e.g. "Change the search to see more clusters." */
  body: string;
  /** Clears the search or filters; without it the row has no action. */
  onClear?: () => void;
};

/**
 * A table row for a search or filter that matches nothing: PatternFly's empty state in a table,
 * the same on every list.
 */
export const TableEmptyRow: React.FC<Props> = ({ colSpan, body, onClear }) => (
  <Tr>
    <Td colSpan={colSpan}>
      <Bullseye>
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
      </Bullseye>
    </Td>
  </Tr>
);
