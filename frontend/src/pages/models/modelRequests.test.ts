import { create } from '@bufbuild/protobuf';
import { ModelSchema, type ModelSpec } from '../../gen/ai_grid/v1/model_type_pb';
import configExample from '../../../../mock/examples/get-config.json';
import type { ModelHardware } from '../../api/types';
import { envWithHardware, knownAccelerators, matchingHardware, wholeCount } from './modelHardware';
import { updateRequestOf, type ModelInput } from './modelRequests';
import { toModelView, type ModelView } from './modelView';

const hardwareList: ModelHardware[] = configExample.body.data.models.hardware;
const cpuOnly = hardwareList.find((h) => h.id === 'cpu')!;
const nvidia = hardwareList.find((h) => h.id === 'nvidia-gpu')!;
const gaudi: ModelHardware = { id: 'gaudi', label: 'Intel Gaudi', accelerator: 'habana.ai/gaudi' };

/** A stored model, as Models/Get answers it, on one NVIDIA GPU unless the spec says otherwise. */
const stored = (spec: Partial<Omit<ModelSpec, '$typeName'>> = {}): ModelView =>
  toModelView(
    create(ModelSchema, {
      id: 'widget',
      metadata: { name: 'widget', version: 3, annotations: {} },
      spec: {
        model: { uri: 'hf://org/widget', name: 'widget' },
        replicas: 1,
        main: { image: '', requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1' }, env: [] },
        ...spec,
      },
    }),
  );

/** The wizard's fields as an edit of the model starts them: nothing changed. */
const unchanged = (model: ModelView): ModelInput => ({
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
  env: model.env.map(({ name, value }) => ({ name, value })),
  baseRefs: model.baseRefs,
  runtimeArgs: [],
  clusters: [],
  knownAccelerators: knownAccelerators(hardwareList),
});

describe('updateRequestOf', () => {
  it('sends nothing for an edit that changes nothing', () => {
    expect(updateRequestOf(stored(), unchanged(stored()))).toBeUndefined();
  });

  it('sends a new model URI as spec.model, without a served name', () => {
    const model = stored();
    const request = updateRequestOf(model, { ...unchanged(model), modelUri: 'oci://quay.io/org/widget:2' });
    expect(request?.updateMask).toEqual({ paths: ['spec.model'] });
    expect(request?.object?.spec).toEqual({ model: { uri: 'oci://quay.io/org/widget:2' } });
    expect(request?.object?.metadata).toEqual({ name: 'widget', version: 3 });
    expect(request?.lock).toBe(true);
  });

  it('sends the requests whole when CPU, memory, or the accelerator count changes, keeping other resources', () => {
    const model = stored({
      main: {
        $typeName: 'ai_grid.v1.ModelContainer',
        image: '',
        requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '1', 'ephemeral-storage': '20Gi' },
        limits: {},
        env: [],
      },
    });
    const request = updateRequestOf(model, { ...unchanged(model), cpu: '500m', memory: '8Gi', acceleratorCount: 4 });
    expect(request?.updateMask).toEqual({ paths: ['spec.main.requests'] });
    expect(request?.object?.spec?.main).toEqual({
      requests: { cpu: '500m', memory: '8Gi', 'nvidia.com/gpu': '4', 'ephemeral-storage': '20Gi' },
    });
  });

  it('replaces the accelerator with another hardware’s, or drops it for CPU only', () => {
    const model = stored();
    const amd = updateRequestOf(model, { ...unchanged(model), accelerator: 'amd.com/gpu', acceleratorCount: 2 });
    expect(amd?.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'amd.com/gpu': '2' });
    const cpu = updateRequestOf(model, { ...unchanged(model), accelerator: undefined, acceleratorCount: 0 });
    expect(cpu?.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi' });
  });

  describe('a model that also requests a resource no hardware names', () => {
    const withRdma = (accelerator: string) =>
      stored({
        main: {
          $typeName: 'ai_grid.v1.ModelContainer',
          image: '',
          requests: { cpu: '2', memory: '16Gi', [accelerator]: '1', 'rdma/hca': '1' },
          limits: {},
          env: [],
        },
      });
    // A list with an entry for an accelerator that isn't a GPU.
    const listed = knownAccelerators([...hardwareList, gaudi]);

    it('keeps that resource when the accelerator count changes', () => {
      const model = withRdma('nvidia.com/gpu');
      const request = updateRequestOf(model, {
        ...unchanged(model),
        accelerator: 'nvidia.com/gpu',
        acceleratorCount: 3,
      });
      expect(request?.updateMask).toEqual({ paths: ['spec.main.requests'] });
      expect(request?.object?.spec?.main?.requests).toEqual({
        cpu: '2',
        memory: '16Gi',
        'nvidia.com/gpu': '3',
        'rdma/hca': '1',
      });
    });

    it.each([
      ['nvidia.com/gpu', 'amd.com/gpu'],
      ['nvidia.com/gpu', 'habana.ai/gaudi'],
      ['habana.ai/gaudi', 'nvidia.com/gpu'],
    ])('keeps that resource when other hardware replaces %s with %s', (from, to) => {
      const model = withRdma(from);
      const request = updateRequestOf(model, {
        ...unchanged(model),
        accelerator: to,
        acceleratorCount: 2,
        knownAccelerators: listed,
      });
      expect(request?.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', [to]: '2', 'rdma/hca': '1' });
    });

    it.each(['nvidia.com/gpu', 'amd.com/gpu', 'habana.ai/gaudi'])(
      'removes only the known accelerator %s when CPU only is selected',
      (accelerator) => {
        const model = withRdma(accelerator);
        const request = updateRequestOf(model, {
          ...unchanged(model),
          accelerator: undefined,
          acceleratorCount: 0,
          knownAccelerators: listed,
        });
        expect(request?.object?.spec?.main?.requests).toEqual({ cpu: '2', memory: '16Gi', 'rdma/hca': '1' });
      },
    );
  });

  it('keeps the accelerators as stored when the edit keeps them, and removes an emptied CPU request', () => {
    const model = stored({
      main: {
        $typeName: 'ai_grid.v1.ModelContainer',
        image: 'r/vllm:1',
        requests: { cpu: '2', memory: '16Gi', 'amd.com/gpu': '2', 'habana.ai/gaudi': '1' },
        limits: {},
        env: [],
      },
    });
    const request = updateRequestOf(model, {
      ...unchanged(model),
      accelerator: undefined,
      acceleratorCount: 0,
      keepAccelerators: true,
      cpu: '',
    });
    expect(request?.object?.spec?.main?.requests).toEqual({
      memory: '16Gi',
      'amd.com/gpu': '2',
      'habana.ai/gaudi': '1',
    });
  });

  it('sends spec.base_refs empty when the presets are removed, and nothing for presets kept', () => {
    const model = stored({ baseRefs: ['custom-preset'] });
    expect(updateRequestOf(model, unchanged(model))).toBeUndefined();
    const request = updateRequestOf(model, { ...unchanged(model), baseRefs: [] });
    expect(request?.updateMask).toEqual({ paths: ['spec.base_refs'] });
    expect(request?.object?.spec).toEqual({ baseRefs: [] });
  });

  it('sends the env whole when the hardware changes it, the runtime arguments kept as stored', () => {
    const model = stored({
      main: {
        $typeName: 'ai_grid.v1.ModelContainer',
        image: '',
        requests: { cpu: '2' },
        limits: {},
        env: [
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_ADDITIONAL_ARGS', value: '--a  --b' },
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'TEAM', value: 'research' },
        ],
      },
    });
    const request = updateRequestOf(model, {
      ...unchanged(model),
      env: envWithHardware(model.env, cpuOnly, hardwareList),
      runtimeArgs: ['--a', '--b'],
    });
    expect(request?.updateMask).toEqual({ paths: ['spec.main.env'] });
    expect(request?.object?.spec?.main?.env).toEqual([
      { name: 'TEAM', value: 'research' },
      { name: 'OMP_NUM_THREADS', value: '4' },
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--a  --b' },
    ]);
  });

  it('orders the paths the same way whatever changes', () => {
    const model = stored({ baseRefs: ['custom-preset'] });
    const request = updateRequestOf(model, {
      ...unchanged(model),
      modelUri: 'hf://org/other',
      replicas: 2,
      baseRefs: [],
      runtimeImage: 'r/vllm:2',
      cpu: '4',
      runtimeArgs: ['--enforce-eager'],
      displayName: 'Widget',
    });
    expect(request?.updateMask?.paths).toEqual([
      'spec.model',
      'spec.replicas',
      'spec.base_refs',
      'spec.main.image',
      'spec.main.requests',
      'spec.main.env',
      'metadata.annotations',
    ]);
  });
});

describe('wholeCount', () => {
  it.each([
    ['3', '3'],
    ['3000m', '3'],
    ['+2', '2'],
    ['1k', '1000'],
    ['2e0', '2'],
    ['1Ki', '1024'],
    ['3.0', '3'],
  ])('reads %s as %s', (quantity, count) => {
    expect(wholeCount(quantity)).toBe(count);
  });

  it.each(['1500m', '0.5', 'two', ''])('reads %s as no whole number', (quantity) => {
    expect(wholeCount(quantity)).toBeUndefined();
  });
});

describe('matchingHardware', () => {
  it('matches the entry a model was deployed with', () => {
    expect(matchingHardware(stored(), hardwareList)).toBe(nvidia);
    const cpu = stored({
      main: {
        $typeName: 'ai_grid.v1.ModelContainer',
        image: cpuOnly.image!,
        requests: { cpu: '4', memory: '8Gi' },
        limits: {},
        env: [
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'OMP_NUM_THREADS', value: '4' },
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len 8192' },
        ],
      },
    });
    expect(matchingHardware(cpu, hardwareList)).toBe(cpuOnly);
  });

  it('matches by the accelerator, whatever image the model has of its own', () => {
    const custom = (image: string) =>
      stored({
        main: {
          $typeName: 'ai_grid.v1.ModelContainer',
          image,
          requests: { cpu: '2', memory: '16Gi', 'nvidia.com/gpu': '2' },
          limits: {},
          env: [],
        },
      });
    expect(matchingHardware(custom('registry.example/vllm-cuda:mine'), hardwareList)).toBe(nvidia);
    // CPU only on another CPU image, with CPU only's settings, is still CPU only.
    const cpu = stored({
      main: {
        $typeName: 'ai_grid.v1.ModelContainer',
        image: 'registry.example/vllm-cpu:mine',
        requests: { cpu: '4' },
        limits: {},
        env: [
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'OMP_NUM_THREADS', value: '4' },
          { $typeName: 'ai_grid.v1.ModelEnvVar', name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
        ],
      },
    });
    expect(matchingHardware(cpu, hardwareList)).toBe(cpuOnly);
  });

  it.each([
    ['another accelerator', { image: '', requests: { 'amd.com/gpu': '1' }, env: [] }],
    ['two accelerators', { image: '', requests: { 'nvidia.com/gpu': '1', 'habana.ai/gaudi': '1' }, env: [] }],
    [
      'an entry’s variable with another value',
      {
        image: cpuOnly.image!,
        requests: {},
        env: [
          { $typeName: 'ai_grid.v1.ModelEnvVar' as const, name: 'OMP_NUM_THREADS', value: '8' },
          { $typeName: 'ai_grid.v1.ModelEnvVar' as const, name: 'VLLM_CPU_KVCACHE_SPACE', value: '4' },
        ],
      },
    ],
  ])('matches none for a model with %s', (_, main) => {
    const model = stored({ main: { $typeName: 'ai_grid.v1.ModelContainer', limits: {}, ...main } });
    expect(matchingHardware(model, hardwareList)).toBeUndefined();
  });

  it('matches none for a model with presets, which set part of its image and environment', () => {
    expect(matchingHardware(stored({ baseRefs: ['custom-preset'] }), hardwareList)).toBeUndefined();
  });
});
