// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/ViewSubscriptionPage.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/ViewSubscriptionPage.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Telemetry is dropped; a viewer gets no actions; the console adds the Organization. The page
// has one view, so it shows its sections without odh-dashboard's single "Details" tab, and its status
// beside its title, as every details page does.
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, BreadcrumbItem, Flex } from '@patternfly/react-core';
import type { SubscriptionsService } from '../../api/subscriptions';
import type { MaaSModelRefSummary, MaaSSubscription, SubscriptionInfoResponse } from '../../api/types';
import { MaasModelsSection } from '../../components/MaasModelsSection';
import { SimpleMenuActions } from '../../components/SimpleMenuActions';
import type { GovernanceService } from '../../context/useMaaSGovernanceContext';
import { useMaaSGovernanceContext } from '../../context/useMaaSGovernanceContext';
import { useGetSubscriptionInfo } from './hooks/useGetSubscriptionInfo';
import { modelRefsToSummaries } from '../../utilities/authpolicies';
import { getBackUrl, getSubscriptionEditUrl, subscriptionNotFound } from '../../utilities/maasGovernanceNavigation';
import { PageStateSection } from '../../components/states/PageStateSection';
import { PhaseLabel } from './Phase/PhaseLabel';
import { useDeleteSubscription } from './hooks/useDeleteSubscription';
import { SubscriptionDetailsSection } from './viewSubscription/SubscriptionDetailsSection';
import { SubscriptionGroupsSection } from './viewSubscription/SubscriptionGroupsSection';

type ActionsProps = { service: SubscriptionsService; subscription: MaaSSubscription; returnTo: string };

const SubscriptionActions: React.FC<ActionsProps> = ({ service, subscription, returnTo }) => {
  const navigate = useNavigate();
  const { refresh } = useMaaSGovernanceContext();
  const [confirmDelete, deleteDialog] = useDeleteSubscription(service, {
    onDeleted: () => {
      refresh();
      navigate(returnTo, { state: { notice: 'Subscription deleted' } });
    },
  });
  return (
    <>
      <SimpleMenuActions
        toggleLabel="Actions"
        testId="subscription-actions-toggle"
        ariaLabel={`Actions for ${subscription.displayName ?? subscription.name}`}
        dropdownItems={[
          {
            key: 'edit',
            label: 'Edit',
            onClick: () => navigate(getSubscriptionEditUrl(subscription.name), { state: { returnTo } }),
            isDisabled: !!subscription.deletionTimestamp,
          },
          { isSpacer: true },
          {
            key: 'delete',
            label: 'Delete',
            isDanger: true,
            onClick: () => confirmDelete(subscription),
            isDisabled: !!subscription.deletionTimestamp,
          },
        ]}
      />
      {deleteDialog}
    </>
  );
};

const viewModelRefSummaries = (info: SubscriptionInfoResponse): MaaSModelRefSummary[] =>
  modelRefsToSummaries(
    Array.isArray(info.subscription.modelRefs) ? info.subscription.modelRefs : [],
    Array.isArray(info.modelRefs) ? info.modelRefs : [],
  );

type Props = { service: GovernanceService };

export const ViewSubscriptionPage: React.FC<Props> = ({ service }) => {
  const { subscriptionName = '' } = useParams<{ subscriptionName: string }>();
  const location = useLocation();
  const [subscriptionInfo, loaded, loadError, reload] = useGetSubscriptionInfo(service, subscriptionName);
  const { canWrite, organizations } = useMaaSGovernanceContext();
  const displaySubscriptionName = subscriptionInfo?.subscription.displayName?.trim() || subscriptionName;
  const backUrl = getBackUrl(location.state, 'subscriptions');
  const organizationId = subscriptionInfo?.subscription.tokenMetadata?.organizationId ?? '';
  const organization = organizations.find((o) => o.id === organizationId)?.name ?? organizationId;

  return (
    <PageStateSection
      title={displaySubscriptionName}
      status={
        subscriptionInfo && (
          <span data-testid="subscription-phase">
            <PhaseLabel
              phase={subscriptionInfo.subscription.phase}
              statusMessage={subscriptionInfo.subscription.statusMessage}
              reason={subscriptionInfo.subscription.reason}
            />
          </span>
        )
      }
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbItem>
            <Link to={backUrl} data-testid="breadcrumb-subscriptions-link">
              Subscriptions
            </Link>
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{displaySubscriptionName}</BreadcrumbItem>
        </Breadcrumb>
      }
      headerAction={
        subscriptionInfo &&
        canWrite && (
          <SubscriptionActions service={service} subscription={subscriptionInfo.subscription} returnTo={backUrl} />
        )
      }
      loaded={loaded}
      error={loadError}
      onRetry={() => void reload()}
      subject="Subscriptions"
      object="subscription"
      loadingLabel="Loading subscription"
      notFound={subscriptionNotFound(subscriptionName, backUrl)}
    >
      {subscriptionInfo && (
        <Flex
          direction={{ default: 'column' }}
          flexWrap={{ default: 'nowrap' }}
          spaceItems={{ default: 'spaceItemsXl' }}
        >
          <SubscriptionDetailsSection
            subscription={subscriptionInfo.subscription}
            authPolicies={Array.isArray(subscriptionInfo.authPolicies) ? subscriptionInfo.authPolicies : []}
            organization={organization}
          />
          <SubscriptionGroupsSection groups={subscriptionInfo.subscription.owner.groups} />
          <MaasModelsSection
            modelRefSummaries={viewModelRefSummaries(subscriptionInfo)}
            modelRefsWithRateLimits={subscriptionInfo.subscription.modelRefs}
          />
        </Flex>
      )}
    </PageStateSection>
  );
};
