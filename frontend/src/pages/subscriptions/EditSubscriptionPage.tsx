// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/subscriptions/EditSubscriptionPage.tsx at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/pages/subscriptions/EditSubscriptionPage.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core';
import { PageStateSection } from '../../components/states/PageStateSection';
import { getBackUrl, getSubscriptionViewUrl, subscriptionNotFound } from '../../utilities/maasGovernanceNavigation';
import type { SubscriptionsGetResponse } from '../../gen/ai_grid/v1/subscriptions_service_pb';
import { CreateSubscriptionForm } from './createSubscription/CreateSubscriptionForm';
import { displayNameOf } from '../models/modelView';
import { modelIdsOf } from './subscriptionText';
import { useModelsByIds, useSubscription } from './useSubscriptions';

export const EditSubscriptionPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { state } = useLocation();
  const returnTo = getBackUrl(state, 'subscriptions');
  const { data: loadedInfo, loaded: infoLoaded, error: infoError, refresh: reloadInfo } = useSubscription(id);
  // The first answer stays the form's: Save sends its version with lock, and the fields the form
  // doesn't edit as they were then, so a later answer (a refetch on window focus) mustn't replace
  // it underneath the user. Someone else's save in between is then a conflict, not overwritten.
  const [info, setInfo] = useState<SubscriptionsGetResponse>();
  if (loadedInfo && !info) setInfo(loadedInfo);
  // Only the models the subscription's refs name (Models/List filtered by their ids).
  const {
    data: models,
    loaded: modelsLoaded,
    error: modelsError,
    refresh: reloadModels,
  } = useModelsByIds(modelIdsOf(loadedInfo?.object ? [loadedInfo.object] : []));

  const loaded = infoLoaded && modelsLoaded;
  const error = infoError || modelsError;
  const displayName = info?.object ? displayNameOf(info.object) : id;

  return (
    <PageStateSection
      title={`Edit ${displayName}`}
      description={
        displayName ? `Edit the subscription configuration for ${displayName}.` : 'Edit the subscription configuration.'
      }
      breadcrumb={
        <Breadcrumb>
          <BreadcrumbItem render={() => <Link to={returnTo}>Subscriptions</Link>} />
          <BreadcrumbItem render={() => <Link to={getSubscriptionViewUrl(id)}>{displayName}</Link>} />
          <BreadcrumbItem isActive>Edit</BreadcrumbItem>
        </Breadcrumb>
      }
      loaded={loaded}
      error={error}
      subject="Subscriptions"
      object="subscription"
      loadingLabel="Loading subscription"
      hasBodyWrapper={false}
      notFound={subscriptionNotFound(id, returnTo)}
      onRetry={() => {
        void reloadInfo();
        void reloadModels();
      }}
    >
      {info && <CreateSubscriptionForm models={models} subscriptionInfo={info} returnTo={returnTo} />}
    </PageStateSection>
  );
};
