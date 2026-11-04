// What the backend at the pin stores and reads back, field by field, so a write that landed always
// matches what it sent (internal/servers in ai-grid-provider-backend at .backend-api-version).
import { create } from '@bufbuild/protobuf';
import { ModelSchema } from '../gen/ai_grid/v1/model_type_pb';
import { SubscriptionSchema } from '../gen/ai_grid/v1/subscription_type_pb';
import { holdsSent, modelFields, sentModelFields, sentSubscriptionFields, subscriptionFields } from './writeFields';

const placement = (values: string[]) => ({
  labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values }] },
});

describe('a model', () => {
  it('compares clusters as a set: the backend sorts them and drops repeats (gitPlacementClusters)', () => {
    const sent = sentModelFields({ id: 'm', spec: { placement: placement(['site-b', 'site-a', 'site-a']) } });
    const read = modelFields(create(ModelSchema, { id: 'm', spec: { placement: placement(['site-a', 'site-b']) } }));
    expect(holdsSent(sent, read)).toBe(true);
    const other = modelFields(create(ModelSchema, { id: 'm', spec: { placement: placement(['site-a']) } }));
    expect(holdsSent(sent, other)).toBe(false);
  });

  it('compares requests as the strings sent, which the backend stores as they are (stringMapToInterfaceMap)', () => {
    const sent = sentModelFields({ id: 'm', spec: { main: { requests: { memory: '16Gi', cpu: '2' } } } });
    const same = modelFields(
      create(ModelSchema, { id: 'm', spec: { main: { requests: { cpu: '2', memory: '16Gi' } } } }),
    );
    const other = modelFields(
      create(ModelSchema, { id: 'm', spec: { main: { requests: { cpu: '3', memory: '16Gi' } } } }),
    );
    expect(holdsSent(sent, same)).toBe(true);
    expect(holdsSent(sent, other)).toBe(false);
  });
});

describe('a subscription', () => {
  const spec = (groups: string[]) => ({ owner: { groups }, organization: { id: 'acme' } });

  it('compares groups as the backend keeps them: trimmed, bare, without repeats, in any order (qualifiedOwnerGroups)', () => {
    const sent = sentSubscriptionFields({ id: 's', spec: spec([' eng ', 'acme/ops', 'eng']) });
    const read = subscriptionFields(create(SubscriptionSchema, { id: 's', spec: spec(['ops', 'eng']) }));
    expect(holdsSent(sent, read)).toBe(true);
    const other = subscriptionFields(create(SubscriptionSchema, { id: 's', spec: spec(['eng']) }));
    expect(holdsSent(sent, other)).toBe(false);
  });

  it('ignores the token limits of an unlimited model, which the backend doesn’t store', () => {
    const ref = (unlimited: boolean, limits: { limit: bigint; window: string }[]) => ({
      name: 'granite',
      unlimited,
      tokenRateLimits: limits,
    });
    const sent = sentSubscriptionFields({
      id: 's',
      spec: { modelRefs: [ref(true, [{ limit: 1000n, window: '1h' }])] },
    });
    const read = subscriptionFields(create(SubscriptionSchema, { id: 's', spec: { modelRefs: [ref(true, [])] } }));
    expect(holdsSent(sent, read)).toBe(true);
    const limited = sentSubscriptionFields({
      id: 's',
      spec: { modelRefs: [ref(false, [{ limit: 1000n, window: '1h' }])] },
    });
    const otherLimit = subscriptionFields(
      create(SubscriptionSchema, { id: 's', spec: { modelRefs: [ref(false, [{ limit: 2000n, window: '1h' }])] } }),
    );
    expect(holdsSent(limited, otherLimit)).toBe(false);
  });
});
