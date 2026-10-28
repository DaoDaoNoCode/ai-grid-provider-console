// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/EditSubscriptionPage.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/EditSubscriptionPage.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import { Link, useLocation, useParams } from 'react-router-dom';
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core';
import type { GovernanceService } from '../../context/useMaaSGovernanceContext';
import { useMaaSGovernanceContext } from '../../context/useMaaSGovernanceContext';
import { useGetSubscriptionInfo } from '../../hooks/useGetSubscriptionInfo';
import { getBackUrl, getSubscriptionViewUrl, subscriptionNotFound } from '../../utilities/maasGovernanceNavigation';
import { PageStateSection } from '../../components/states/PageStateSection';
import { CreateSubscriptionForm } from './createSubscription/CreateSubscriptionForm';

type Props = { service: GovernanceService };

export const EditSubscriptionPage: React.FC<Props> = ({ service }) => {
  const { subscriptionName = '' } = useParams<{ subscriptionName: string }>();
  const { state } = useLocation();
  const returnTo = getBackUrl(state, 'subscriptions');
  const [subscriptionInfo, infoLoaded, infoError, reloadInfo] = useGetSubscriptionInfo(service, subscriptionName);
  const { modelRefs, loaded: formLoaded, error: formError, refresh } = useMaaSGovernanceContext();

  const loaded = infoLoaded && formLoaded;
  const error = infoError || formError;
  const displayName =
    subscriptionInfo?.subscription.displayName || subscriptionInfo?.subscription.name || subscriptionName;

  return (
    <PageStateSection
      title={`Edit ${displayName}`}
      description={
        displayName ? `Edit the subscription configuration for ${displayName}.` : 'Edit the subscription configuration.'
      }
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbItem render={() => <Link to={returnTo}>Subscriptions</Link>} />
          <BreadcrumbItem render={() => <Link to={getSubscriptionViewUrl(subscriptionName)}>{displayName}</Link>} />
          <BreadcrumbItem isActive>Edit</BreadcrumbItem>
        </Breadcrumb>
      }
      loaded={loaded}
      error={error}
      subject="Subscriptions"
      object="subscription"
      loadingLabel="Loading subscription"
      hasBodyWrapper={false}
      notFound={subscriptionNotFound(subscriptionName, returnTo)}
      onRetry={() => {
        void reloadInfo();
        refresh();
      }}
    >
      {subscriptionInfo && (
        <CreateSubscriptionForm
          service={service}
          modelRefs={modelRefs}
          subscriptionInfo={subscriptionInfo}
          returnTo={returnTo}
        />
      )}
    </PageStateSection>
  );
};
