// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/allSubscriptions/SubscriptionTableRow.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/allSubscriptions/SubscriptionTableRow.tsx
// upstream commit: 6f47c0f775d19c89ef02f74d192b32dc7d3c669d
// The console adds the Organization and Priority cells, and the row menu is the console's
// SimpleMenuActions, for writers only, as on every list. As in
// the org admin's view, the description sits under the name, and the Groups and Models counts
// open the row's groups or its models with their locations and token limits (compound expansion).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Tooltip } from '@patternfly/react-core';
import { ExpandableRowContent, TableText, Tbody, Td, Tr } from '@patternfly/react-table';
import type { MaaSSubscription, ManagedModel } from '../../../api/types';
import { PhaseLabel } from '../Phase/PhaseLabel';
import { SimpleMenuActions } from '../../../components/SimpleMenuActions';
import { TableRowTitleDescription } from '../../../components/TableRowTitleDescription';
import { useSubscriptionAffectedModels } from '../hooks/useGovernanceAffectedModels';
import { getSubscriptionEditUrl, getSubscriptionViewUrl } from '../../../utilities/maasGovernanceNavigation';
import { EMPTY_VALUE } from '../../../utilities/format';
import type { SubscriptionColumn } from './columns';
import { ExpandedGroupsPanel } from './ExpandedGroupsPanel';
import type { ModelsState } from './ExpandedModelsPanel';
import { ExpandedModelsPanel } from './ExpandedModelsPanel';

type Props = {
  subscription: MaaSSubscription;
  columns: SubscriptionColumn[];
  organization: string;
  /** The hub's models, for the models expansion, and whether they have loaded. */
  models: ManagedModel[];
  modelsState: ModelsState;
  siteNames: Map<string, string>;
  canWrite: boolean;
  onDelete: (subscription: MaaSSubscription) => void;
};

type Panel = 'groups' | 'models';

export const SubscriptionTableRow: React.FC<Props> = ({
  subscription,
  columns,
  organization,
  models,
  modelsState,
  siteNames,
  canWrite,
  onDelete,
}) => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Panel>();
  const { affectedModels, overviewLoaded } = useSubscriptionAffectedModels(subscription);
  const groups = Array.isArray(subscription.owner.groups) ? subscription.owner.groups : [];
  const deleting = !!subscription.deletionTimestamp;
  const title = subscription.displayName ?? subscription.name;

  // A subscription being deleted can't be changed: its items stay, disabled, with why.
  const deletingReason = deleting ? 'This subscription is being deleted.' : undefined;

  const panelId = (panel: Panel) => `subscription-${subscription.name}-${panel}-panel`;

  /**
   * The Groups or Models cell: its count toggles that panel, and only one is open at a time.
   * PatternFly's compound expansion markup, written out because Td's compoundExpand can't set the
   * button's aria-controls, which names the row the button opens.
   */
  const expandCell = (panel: Panel, columnIndex: number, count: number) => {
    const isExpanded = expanded === panel;
    return (
      <Td
        dataLabel={columns[columnIndex].label}
        className={`pf-v6-c-table__compound-expansion-toggle${isExpanded ? ' pf-m-expanded' : ''}`}
        data-testid={`subscription-${panel}`}
      >
        <button
          type="button"
          className="pf-v6-c-table__button"
          id={`subscription-${subscription.name}-${panel}-toggle`}
          aria-expanded={isExpanded}
          aria-controls={panelId(panel)}
          onClick={() => setExpanded((open) => (open === panel ? undefined : panel))}
        >
          <TableText>{count}</TableText>
        </button>
      </Td>
    );
  };

  return (
    <Tbody isExpanded={!!expanded}>
      <Tr isControlRow aria-disabled={deleting || undefined} data-testid="subscription-row">
        <Td dataLabel={columns[0].label}>
          <TableRowTitleDescription
            title={
              deleting ? (
                <span data-testid="subscription-name">{title}</span>
              ) : (
                <Tooltip content={`Resource name: ${subscription.name}`}>
                  <Link to={getSubscriptionViewUrl(subscription.name)}>{title}</Link>
                </Tooltip>
              )
            }
            subtitle={
              subscription.description && (
                <div className="console-clamp-2" data-testid="subscription-description">
                  {subscription.description}
                </div>
              )
            }
          />
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
        {expandCell('groups', 3, groups.length)}
        {expandCell('models', 4, subscription.modelRefs.length)}
        <Td dataLabel={columns[5].label} className="console-number">
          {subscription.priority ?? EMPTY_VALUE}
        </Td>
        {canWrite && (
          <Td isActionCell>
            <SimpleMenuActions
              testId="subscription-actions"
              ariaLabel={`Actions for ${title}`}
              dropdownItems={[
                {
                  key: 'view',
                  label: 'View details',
                  onClick: () => navigate(getSubscriptionViewUrl(subscription.name)),
                },
                {
                  key: 'edit',
                  label: 'Edit',
                  disabledReason: deletingReason,
                  onClick: () => navigate(getSubscriptionEditUrl(subscription.name)),
                },
                { isSpacer: true },
                {
                  key: 'delete',
                  label: 'Delete',
                  isDanger: true,
                  disabledReason: deletingReason,
                  onClick: () => onDelete(subscription),
                },
              ]}
            />
          </Td>
        )}
      </Tr>
      <Tr isExpanded={expanded === 'groups'} id={panelId('groups')}>
        <Td colSpan={columns.length + (canWrite ? 1 : 0)}>
          <ExpandableRowContent>
            {expanded === 'groups' && <ExpandedGroupsPanel groups={groups} />}
          </ExpandableRowContent>
        </Td>
      </Tr>
      <Tr isExpanded={expanded === 'models'} id={panelId('models')}>
        <Td colSpan={columns.length + (canWrite ? 1 : 0)}>
          <ExpandableRowContent>
            {expanded === 'models' && (
              <ExpandedModelsPanel
                modelRefs={subscription.modelRefs}
                models={models}
                modelsState={modelsState}
                siteNames={siteNames}
              />
            )}
          </ExpandableRowContent>
        </Td>
      </Tr>
    </Tbody>
  );
};
