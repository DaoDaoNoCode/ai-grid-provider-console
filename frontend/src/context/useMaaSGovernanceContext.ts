// Ported from krisv/ai-grid-cloud-provider-poc src/app/context/MaaSGovernanceContext.tsx at 62319b8:
// the context and its hook, in their own module so MaaSGovernanceContext.tsx exports only the
// provider (ruling A4). The context also carries the signed-in user, which the subscription
// pages need to hide write actions.
import { createContext, useContext } from 'react';
import type { UserService } from '../api/ConsoleService';
import type { ModelsService } from '../api/models';
import type { SubscriptionsService } from '../api/subscriptions';
import type { MaaSModelRefSummary, MaaSSubscription } from '../api/types';
import { useServiceData } from '../hooks/useServiceData';

/** What the subscription pages call. */
export type GovernanceService = SubscriptionsService & ModelsService & UserService;

/** Polls the subscriptions and the models, as the PoC's provider does. */
export const useMaaSGovernanceData = (service: GovernanceService) => {
  const [subscriptions, subscriptionsLoaded, subscriptionsError, refreshSubscriptions] = useServiceData<
    MaaSSubscription[]
  >(() => service.listSubscriptions(), []);
  const [modelRefs, modelRefsLoaded, modelRefsError, refreshModels] = useServiceData<MaaSModelRefSummary[]>(
    () => service.listModels(),
    [],
  );
  const [user] = useServiceData(() => service.getUser(), undefined, 0);
  const refresh = () => {
    void refreshSubscriptions();
    void refreshModels();
  };
  const overviewLoaded = subscriptionsLoaded && modelRefsLoaded;
  return {
    subscriptions,
    modelRefs,
    subscriptionsLoaded,
    subscriptionsError,
    overviewLoaded,
    loaded: overviewLoaded,
    error: subscriptionsError ?? modelRefsError,
    refresh,
    /** UI hint only; the backend enforces authorization. */
    canWrite: !!user?.isProviderAdmin,
  };
};

export type MaaSGovernanceData = ReturnType<typeof useMaaSGovernanceData>;

export const MaaSGovernanceContext = createContext<MaaSGovernanceData | null>(null);

export const useMaaSGovernanceContext = (): MaaSGovernanceData => {
  const context = useContext(MaaSGovernanceContext);
  if (!context) throw new Error('Governance provider missing.');
  return context;
};
