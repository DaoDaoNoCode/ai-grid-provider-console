import { Link } from 'react-router-dom';
import { Alert, List, ListItem } from '@patternfly/react-core';
import type { ConsoleService } from '../../api/ConsoleService';
import type { SubscriptionsService } from '../../api/subscriptions';
import type { MaaSSubscription, ManagedModel } from '../../api/types';
import { useServiceData } from '../../hooks/useServiceData';

/** A subscription's model reference without a namespace means the console's models namespace. */
const references = (subscription: MaaSSubscription, model: ManagedModel, modelsNamespace: string) =>
  subscription.modelRefs.some(
    (ref) => ref.name === model.name && (ref.namespace ?? modelsNamespace) === model.namespace,
  );

/** The subscriptions that still give access to the model, which the user should change first. */
export const ReferencingSubscriptions: React.FC<{
  service: Pick<SubscriptionsService, 'listSubscriptions'> & Pick<ConsoleService, 'getConfig'>;
  model: ManagedModel;
}> = ({ service, model }) => {
  const [subscriptions, loaded] = useServiceData(() => service.listSubscriptions(), [], 0);
  const [config] = useServiceData(() => service.getConfig(), undefined, 0);
  const using = config
    ? subscriptions.filter((subscription) => references(subscription, model, config.modelsNamespace))
    : [];
  if (!loaded || using.length === 0) {
    return null;
  }
  return (
    <Alert isInline isPlain variant="warning" title="Subscriptions still use this model" data-testid="model-references">
      <p>Remove the model from these subscriptions first, or their members lose access to it:</p>
      <List>
        {using.map((subscription) => (
          <ListItem key={subscription.name}>
            <Link to={`/subscriptions/view/${encodeURIComponent(subscription.name)}`}>
              {subscription.displayName || subscription.name}
            </Link>
          </ListItem>
        ))}
      </List>
    </Alert>
  );
};
