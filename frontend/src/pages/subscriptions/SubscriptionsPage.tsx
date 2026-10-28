// Ported from krisv/ai-grid-cloud-provider-poc src/app/App.tsx (the /subscriptions route) at 62319b8.
import { PageHeader } from '../../components/PageHeader';
import type { GovernanceService } from '../../context/useMaaSGovernanceContext';
import { SubscriptionsTab } from './SubscriptionsTab';

type Props = { service: GovernanceService };

export const SubscriptionsPage: React.FC<Props> = ({ service }) => (
  <>
    <PageHeader
      title="Subscriptions"
      description="Manage subscriptions to models available through Models as a Service."
    />
    <SubscriptionsTab service={service} />
  </>
);
