// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/allSubscriptions/SubscriptionTableRow.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/allSubscriptions/SubscriptionTableRow.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The console adds the Organization cell, and a viewer gets only View details. The description
// stays on the subscription's page, and groups and models show as a short list, not an expansion.
import { Link, useNavigate } from 'react-router-dom';
import { Tooltip } from '@patternfly/react-core';
import { ActionsColumn, Td, Tr } from '@patternfly/react-table';
import type { IAction } from '@patternfly/react-table';
import type { MaaSSubscription } from '../../../api/types';
import { OverflowList } from '../../../components/OverflowList';
import { PhaseLabel } from '../../../components/Phase/PhaseLabel';
import { useSubscriptionAffectedModels } from '../../../hooks/useGovernanceAffectedModels';
import { getSubscriptionEditUrl, getSubscriptionViewUrl } from '../../../utilities/maasGovernanceNavigation';
import { EMPTY_VALUE } from '../../../utilities/format';
import type { SubscriptionColumn } from './columns';

type Props = {
  subscription: MaaSSubscription;
  columns: SubscriptionColumn[];
  organization: string;
  canWrite: boolean;
  setDeleteSubscription: (subscription: MaaSSubscription) => void;
};

export const SubscriptionTableRow: React.FC<Props> = ({
  subscription,
  columns,
  organization,
  canWrite,
  setDeleteSubscription,
}) => {
  const navigate = useNavigate();
  const { affectedModels, overviewLoaded } = useSubscriptionAffectedModels(subscription);
  const groups = Array.isArray(subscription.owner.groups) ? subscription.owner.groups : [];
  const deleting = !!subscription.deletionTimestamp;
  const title = subscription.displayName ?? subscription.name;

  const actions: IAction[] = [
    { title: 'View details', onClick: () => navigate(getSubscriptionViewUrl(subscription.name)) },
    ...(canWrite
      ? [
          { title: 'Edit', onClick: () => navigate(getSubscriptionEditUrl(subscription.name)) },
          { isSeparator: true },
          { title: 'Delete', isDanger: true, onClick: () => setDeleteSubscription(subscription) },
        ]
      : []),
  ];

  return (
    <Tr aria-disabled={deleting || undefined} data-testid="subscription-row">
      <Td dataLabel={columns[0].label}>
        {deleting ? (
          <span data-testid="subscription-name">{title}</span>
        ) : (
          <Tooltip
            content={
              <>
                {subscription.description && <div>{subscription.description}</div>}
                <div>Resource name: {subscription.name}</div>
              </>
            }
          >
            <Link to={getSubscriptionViewUrl(subscription.name)}>{title}</Link>
          </Tooltip>
        )}
      </Td>
      <Td dataLabel={columns[1].label} data-testid="subscription-organization">
        {organization || EMPTY_VALUE}
      </Td>
      <Td dataLabel={columns[2].label}>
        <PhaseLabel
          phase={subscription.phase}
          statusMessage={subscription.statusMessage}
          reason={subscription.reason}
          status={subscription.status}
          conditionType={subscription.conditionType}
          lastTransitionTime={subscription.lastTransitionTime}
          resourceName={title}
          affectedModels={affectedModels}
          overviewLoaded={overviewLoaded}
        />
      </Td>
      <Td dataLabel={columns[3].label} data-testid="subscription-groups">
        <OverflowList noun="Groups" items={groups.map((g) => g.name)} />
      </Td>
      <Td dataLabel={columns[4].label} data-testid="subscription-models">
        <OverflowList noun="Models" items={subscription.modelRefs.map((m) => m.displayName ?? m.name)} />
      </Td>
      <Td dataLabel={columns[5].label} className="console-number">
        {subscription.priority ?? EMPTY_VALUE}
      </Td>
      <Td isActionCell>
        <ActionsColumn data-testid="subscription-actions" isDisabled={deleting} items={actions} />
      </Td>
    </Tr>
  );
};
