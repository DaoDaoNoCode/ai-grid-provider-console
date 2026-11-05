import { create } from '@bufbuild/protobuf';
import {
  ModelDeploymentState,
  ModelPhase,
  ModelSchema,
  ModelState,
  ModelSyncState,
} from '../../gen/ai_grid/v1/model_type_pb';
import { SubscriptionSchema } from '../../gen/ai_grid/v1/subscription_type_pb';
import { SubscriptionsGetResponseSchema } from '../../gen/ai_grid/v1/subscriptions_service_pb';
import { changingSubscriptionInfoOf, changingSubscriptionOf } from '../subscriptions/subscriptionText';
import { changingOf, toModelView } from './modelView';

/** A model placed on site1, starting there, with the backend's message. */
const starting = (message = 'Deployment does not have minimum availability.') =>
  toModelView(
    create(ModelSchema, {
      id: 'granite',
      spec: { placement: {} },
      status: {
        phase: ModelPhase.PENDING,
        state: ModelState.STARTING,
        clusters: [
          {
            cluster: 'site1',
            state: ModelState.STARTING,
            sync: ModelSyncState.SYNCED,
            deployment: ModelDeploymentState.STARTING,
            deploymentMessage: message,
          },
        ],
      },
    }),
  );

describe('changingOf', () => {
  it('words a model still changing by its status words, not its messages', () => {
    expect(changingOf(starting())).toBe(changingOf(starting('Pulling the image.')));
    expect(changingOf(starting())).toContain('granite');
  });

  it('changes when a word does', () => {
    const syncing = starting();
    syncing.clusters[0] = { ...syncing.clusters[0], state: 'Syncing', sync: 'Out of sync' };
    expect(changingOf(syncing)).not.toBe(changingOf(starting()));
  });

  it('is undefined for a settled model', () => {
    const ready = starting();
    ready.state = 'Ready';
    ready.phase = 'Ready';
    ready.clusters[0] = { ...ready.clusters[0], state: 'Ready', deployment: 'Running' };
    expect(changingOf(ready)).toBeUndefined();
  });
});

describe('changingSubscriptionOf and changingSubscriptionInfoOf', () => {
  const subscription = (phase: string) =>
    create(SubscriptionSchema, {
      id: 'team-a',
      spec: { modelRefs: [{ name: 'granite', namespace: 'models' }] },
      status: { phase },
    });

  it('words a Pending subscription by its phase, and nothing once Active', () => {
    expect(changingSubscriptionOf(subscription('Pending'))).toBe('team-a Pending');
    expect(changingSubscriptionOf(subscription('Active'))).toBeUndefined();
  });

  it("words a subscription's page by its phase and each model's registration", () => {
    const info = (phase: string, registration: string) =>
      create(SubscriptionsGetResponseSchema, {
        object: subscription(phase),
        modelRegistrations: [{ name: 'granite', namespace: 'models', phase: registration }],
      });
    expect(changingSubscriptionInfoOf(info('Active', 'Pending'))).toBe('team-a Active models/granite=Pending');
    expect(changingSubscriptionInfoOf(info('Active', 'Failed'))).not.toBe(
      changingSubscriptionInfoOf(info('Active', 'Pending')),
    );
    expect(changingSubscriptionInfoOf(info('Active', 'Ready'))).toBeUndefined();
  });
});
