import { Button, Tooltip } from '@patternfly/react-core';
import { SyncAltIcon } from '@patternfly/react-icons';

type Props = {
  onRefresh: () => void;
  isRefreshing?: boolean;
};

/**
 * Reloads a page's data now. Pages already poll, so this is a plain icon button in the toolbar
 * rather than a prominent action.
 */
export const RefreshButton: React.FC<Props> = ({ onRefresh, isRefreshing }) => (
  <Tooltip content="Refresh">
    <Button variant="plain" aria-label="Refresh" icon={<SyncAltIcon />} isDisabled={isRefreshing} onClick={onRefresh} />
  </Tooltip>
);
