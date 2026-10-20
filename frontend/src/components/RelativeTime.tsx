import { Tooltip } from '@patternfly/react-core';
import { EMPTY_VALUE, formatDateTime, formatRelative } from '../utilities/format';

/** A time in a table cell: "3 days ago", with the full date and time in a tooltip. */
export const RelativeTime: React.FC<{ time?: string }> = ({ time }) =>
  time ? (
    <Tooltip content={formatDateTime(time)}>
      <time dateTime={time} tabIndex={0}>
        {formatRelative(time)}
      </time>
    </Tooltip>
  ) : (
    <>{EMPTY_VALUE}</>
  );
