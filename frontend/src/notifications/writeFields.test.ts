// What the backend at the pin stores and reads back, field by field, so a write that landed always
// matches what it sent (internal/servers in ai-grid-provider-backend at .backend-api-version).
import { create } from '@bufbuild/protobuf';
import { ModelSchema } from '../gen/ai_grid/v1/model_type_pb';
import { SubscriptionSchema } from '../gen/ai_grid/v1/subscription_type_pb';
import { RUNTIME_ARGS_ENV, runtimeArgsOf, type EnvVar } from '../pages/models/fields/runtimeArgs';
import { createRequestOf, updateRequestOf, type ModelInput } from '../pages/models/modelRequests';
import { toModelView } from '../pages/models/modelView';
import { holdsSent, modelFields, sentModelFields, sentSubscriptionFields, subscriptionFields } from './writeFields';

const placement = (values: string[]) => ({
  labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values }] },
});

/** The fields of a deployed model these tests vary. */
type Stored = {
  uri: string;
  replicas: number;
  baseRefs: string[];
  requests: Record<string, string>;
  env: EnvVar[];
};

/** A deployed model: one NVIDIA GPU, a preset, a variable of its own and runtime arguments. */
const deployed: Stored = {
  uri: 'hf://org/widget',
  replicas: 1,
  baseRefs: ['preset-a'],
  requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' },
  env: [
    { name: 'TEAM', value: 'research' },
    { name: RUNTIME_ARGS_ENV, value: '--enforce-eager' },
  ],
};

/** The deployed model as Models/Get answers it at a version, with some of its fields changed. */
const stored = (version: number, changed: Partial<Stored> = {}) => {
  const { uri, replicas, baseRefs, requests, env } = { ...deployed, ...changed };
  return create(ModelSchema, {
    id: 'widget',
    metadata: { name: 'widget', version, annotations: {} },
    spec: {
      model: { uri, name: 'widget' },
      replicas,
      baseRefs,
      main: { image: 'quay.io/org/vllm:1', requests, env },
    },
  });
};

/** The edit wizard's fields for the deployed model, nothing changed. */
const unchanged = (): ModelInput => {
  const model = toModelView(stored(3));
  return {
    name: model.id,
    displayName: model.id,
    description: '',
    modelUri: model.modelUri ?? '',
    runtimeImage: model.runtimeImage ?? '',
    replicas: model.replicas ?? 1,
    cpu: model.cpu ?? '',
    memory: model.memory ?? '',
    accelerator: model.acceleratorRequests[0]?.resource,
    acceleratorCount: Number(model.acceleratorRequests[0]?.count ?? 0),
    env: model.env.filter((v) => v.name !== RUNTIME_ARGS_ENV).map(({ name, value }) => ({ name, value })),
    baseRefs: model.baseRefs,
    runtimeArgs: runtimeArgsOf(model.env),
    clusters: [],
  };
};

type EditCase = { field: string; edit: Partial<ModelInput>; path: string; landed: Partial<Stored> };

// Each edit changes one field, so its mask has one path. `landed` is the model as the backend
// stores the edit (mergeModelUpdate, internal/servers/models_server.go).
const edits: EditCase[] = [
  {
    field: 'the model URI',
    edit: { modelUri: 'hf://org/widget-2' },
    path: 'spec.model',
    landed: { uri: 'hf://org/widget-2' },
  },
  {
    field: 'the CPU',
    edit: { cpu: '500m' },
    path: 'spec.main.requests',
    landed: { requests: { cpu: '500m', memory: '16Gi', 'nvidia.com/gpu': '1' } },
  },
  {
    field: 'the memory',
    edit: { memory: '8Gi' },
    path: 'spec.main.requests',
    landed: { requests: { cpu: '2', memory: '8Gi', 'nvidia.com/gpu': '1' } },
  },
  {
    field: 'the accelerator count',
    edit: { acceleratorCount: 2 },
    path: 'spec.main.requests',
    landed: { requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '2' } },
  },
  {
    field: "the hardware's environment, the runtime arguments unchanged",
    edit: {
      env: [
        { name: 'TEAM', value: 'research' },
        { name: 'OMP_NUM_THREADS', value: '4' },
      ],
    },
    path: 'spec.main.env',
    landed: {
      env: [
        { name: 'TEAM', value: 'research' },
        { name: 'OMP_NUM_THREADS', value: '4' },
        { name: RUNTIME_ARGS_ENV, value: '--enforce-eager' },
      ],
    },
  },
  {
    field: 'the presets, removed',
    edit: { baseRefs: [] },
    path: 'spec.base_refs',
    landed: { baseRefs: [] },
  },
];

describe('a model edit whose answer was lost', () => {
  // `other` is someone else's write that moved the version on and left the edited field as it was.
  it.each(edits)('is confirmed by $field read back, not by a version moved on without it', ({ edit, path, landed }) => {
    const request = updateRequestOf(toModelView(stored(3)), { ...unchanged(), ...edit });
    expect(request?.updateMask?.paths).toEqual([path]);
    const sent = sentModelFields(request?.object, request?.updateMask?.paths);
    expect(holdsSent(sent, modelFields(stored(4, landed)))).toBe(true);
    const other = modelFields(stored(4, { replicas: 2 }));
    expect(holdsSent(sent, other)).toBe(false);
  });
});

describe('a model deploy whose answer was lost', () => {
  it("is confirmed only with the hardware's environment it sent, and no presets", () => {
    const { object } = createRequestOf({
      ...unchanged(),
      baseRefs: undefined,
      env: [{ name: 'OMP_NUM_THREADS', value: '4' }],
      clusters: ['site-a'],
    });
    const sent = sentModelFields(object);
    expect(holdsSent(sent, modelFields(create(ModelSchema, object)))).toBe(true);
    const otherEnv = create(ModelSchema, object);
    otherEnv.spec!.main!.env = otherEnv.spec!.main!.env.map((v) =>
      v.name === 'OMP_NUM_THREADS' ? { ...v, value: '8' } : v,
    );
    expect(holdsSent(sent, modelFields(otherEnv))).toBe(false);
    const withPresets = create(ModelSchema, object);
    withPresets.spec!.baseRefs = ['preset-a'];
    expect(holdsSent(sent, modelFields(withPresets))).toBe(false);
  });
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
