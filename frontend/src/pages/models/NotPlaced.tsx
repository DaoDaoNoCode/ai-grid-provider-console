import { Button, EmptyState, EmptyStateActions, EmptyStateBody, EmptyStateFooter } from '@patternfly/react-core';
import type { ManagedModel } from '../../api/types';

type Props = {
  model: Pick<ManagedModel, 'name' | 'locations' | 'placementIssue'>;
  /** Opens the model's edit page; absent for a viewer. */
  onEdit?: () => void;
};

/**
 * A model row expanded before any cluster reported the model: why, as the backend's placement says
 * when it isn't satisfied (PlacementSatisfied's reason and message), otherwise that it has no
 * locations or that no cluster has reported it yet.
 */
export const NotPlaced: React.FC<Props> = ({ model, onEdit }) => {
  const issue = model.placementIssue;
  return (
    <EmptyState
      variant="xs"
      titleText="Not placed on any cluster yet"
      headingLevel="h3"
      data-testid={`model-not-placed-${model.name}`}
    >
      <EmptyStateBody>
        {issue
          ? [issue.reason, issue.message].filter(Boolean).join(': ')
          : model.locations.length
            ? 'No cluster has reported this model yet.'
            : 'This model has no locations.'}
      </EmptyStateBody>
      {onEdit && (
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="link" onClick={onEdit}>
              Edit locations
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      )}
    </EmptyState>
  );
};
