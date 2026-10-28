// Ported from krisv/ai-grid-cloud-provider-poc src/app/App.tsx (the /subscriptions route) at 62319b8.
import type { GovernanceService } from '../../context/useMaaSGovernanceContext';
import { SubscriptionsList } from './SubscriptionsList';

type Props = { service: GovernanceService };

/** The list, with its header, its states and its delete. */
export const SubscriptionsPage: React.FC<Props> = ({ service }) => <SubscriptionsList service={service} />;
