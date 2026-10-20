import type { LabelProps } from '@patternfly/react-core';
import { Label, Tooltip } from '@patternfly/react-core';
import { statusLabelProps } from '../utilities/status';

type Props = {
  /** The status word, shown as is: Ready, Offline, Failed, Degraded, ... */
  status: string;
  /** A short reason, shown in a tooltip on the label. */
  reason?: string;
  /** Compact size, for tables and cards (PatternFly: compact labels when space is tight). */
  isCompact?: boolean;
  onClick?: LabelProps['onClick'];
  'data-testid'?: string;
};

/**
 * A status as PatternFly's status pattern shows it, the same on every page: a filled label in the
 * status color with its icon. The tone comes from utilities/status.
 */
export const StatusLabel: React.FC<Props> = ({ status, reason, isCompact, onClick, 'data-testid': testId }) => {
  const label = (
    <Label
      {...statusLabelProps(status)}
      variant="filled"
      isCompact={isCompact}
      isClickable={!!onClick}
      onClick={onClick}
      // A reason is only in the tooltip, so the label takes focus to show it from the keyboard
      // (a clickable label's button already does), as RelativeTime does.
      tabIndex={reason && !onClick ? 0 : undefined}
      data-testid={testId}
    >
      {status}
    </Label>
  );
  return reason ? <Tooltip content={reason}>{label}</Tooltip> : label;
};
