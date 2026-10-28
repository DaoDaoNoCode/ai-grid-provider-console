import { Bullseye } from '@patternfly/react-core';
import { Td, Tr } from '@patternfly/react-table';
import { NoResultsState } from './states/NoResultsState';

type Props = {
  /** The table's column count, so the row spans it. */
  colSpan: number;
  /** What to change, e.g. "Change the filter to see more clusters." */
  body: string;
  /** Clears the search or filters; without it the row has no action. */
  onClear?: () => void;
};

/**
 * A table row for a search or filter that matches nothing: PatternFly's empty state in a table,
 * the same on every list. Only for a filter: a table with no rows at all says what is missing.
 */
export const TableEmptyRow: React.FC<Props> = ({ colSpan, body, onClear }) => (
  <Tr>
    <Td colSpan={colSpan}>
      <Bullseye>
        <NoResultsState body={body} onClear={onClear} />
      </Bullseye>
    </Td>
  </Tr>
);
