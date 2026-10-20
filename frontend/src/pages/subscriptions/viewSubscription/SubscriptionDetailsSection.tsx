// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/viewSubscription/SubscriptionDetailsSection.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/viewSubscription/SubscriptionDetailsSection.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The console adds the Organization, the priority and the authorization policies, leaves out the
// name the page title already shows, and lays the details out as every details page does.
import { Flex, Stack } from '@patternfly/react-core';
import type { MaaSAuthPolicy, MaaSSubscription, ModelRegistration } from '../../../api/types';
import { DetailsList } from '../../../components/DetailsList';
import { DetailsSection } from '../../../components/DetailsSection';
import { PhaseLabel } from '../../../components/Phase/PhaseLabel';
import { StatusLabel } from '../../../components/StatusLabel';
import { getSubscriptionAffectedModels } from '../../../hooks/useGovernanceAffectedModels';
import { formatDateTime } from '../../../utilities/format';

type Props = {
  subscription: MaaSSubscription;
  /** The referenced models' MaaSModelRef statuses. */
  modelRegistrations: ModelRegistration[];
  /** The authorization policies that cover any of this subscription's models, as the backend lists them. */
  authPolicies: MaaSAuthPolicy[];
  /** The organization's name, or its id when the organization is unknown. */
  organization: string;
};

export const SubscriptionDetailsSection: React.FC<Props> = ({
  subscription,
  modelRegistrations,
  authPolicies,
  organization,
}) => (
  <div data-testid="subscription-details-section">
    <DetailsSection title="Details">
      <DetailsList
        aria-label="Subscription details"
        items={[
          {
            term: 'Status',
            'data-testid': 'subscription-phase',
            value: (
              <PhaseLabel
                phase={subscription.phase}
                statusMessage={subscription.statusMessage}
                reason={subscription.reason}
                status={subscription.status}
                conditionType={subscription.conditionType}
                lastTransitionTime={subscription.lastTransitionTime}
                resourceName={subscription.displayName ?? subscription.name}
                affectedModels={getSubscriptionAffectedModels(subscription, modelRegistrations)}
              />
            ),
          },
          { term: 'Description', value: subscription.description },
          { term: 'Resource name', value: subscription.name },
          { term: 'Organization', value: organization, 'data-testid': 'subscription-organization' },
          { term: 'Priority', value: subscription.priority, 'data-testid': 'subscription-priority' },
          {
            // The backend lists every policy covering one of the models, whichever groups it
            // grants, so the term says that rather than implying these policies are this
            // subscription's own.
            term: 'Policies for its models',
            'data-testid': 'subscription-auth-policies',
            value: authPolicies.length ? (
              <Stack>
                {authPolicies.map((policy) => (
                  <Flex key={policy.name} spaceItems={{ default: 'spaceItemsSm' }}>
                    <span>{policy.displayName ?? policy.name}</span>
                    {/* A policy's phases are Pending and Active; only a subscription's Active reads Ready. */}
                    <StatusLabel isCompact status={policy.phase?.trim() || 'Unknown'} reason={policy.statusMessage} />
                  </Flex>
                ))}
              </Stack>
            ) : undefined,
          },
          { term: 'Created', value: formatDateTime(subscription.creationTimestamp) },
        ]}
      />
    </DetailsSection>
  </div>
);
