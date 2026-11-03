// What the Deploy model wizard sends: Models/Create with the fields the backend's ModelsCreateRequest
// takes, and Models/Update with only the paths an edit changed (ModelsUpdateRequest.update_mask). A
// new model gets the inference scheduler and a managed route, as the console's models always have:
// the backend defaults the scheduler to off, and without it KServe makes no InferencePool or
// endpoint picker, so the model's route has no backend. The gateway is the backend's default (an
// empty gateway_refs), and an accelerator request is also saved as its limit by the backend
// (ModelContainer.requests). A new model names no presets (spec.base_refs): its hardware's image
// and environment go in its own spec (modelHardware.ts).
import type { MessageInitShape } from '@bufbuild/protobuf';
import type { ModelsCreateRequestSchema, ModelsUpdateRequestSchema } from '../../gen/ai_grid/v1/models_service_pb';
import type { ModelEnvVarSchema, ModelPlacementSchema } from '../../gen/ai_grid/v1/model_type_pb';
import { RUNTIME_ARGS_ENV, runtimeArgsOf, withRuntimeArgs, type EnvVar } from './fields/runtimeArgs';
import { DESCRIPTION, DISPLAY_NAME, type ModelView } from './modelView';

type PlacementInit = MessageInitShape<typeof ModelPlacementSchema>;
type EnvInit = MessageInitShape<typeof ModelEnvVarSchema>;

/** The wizard's fields. */
export type ModelInput = {
  /** The model's id, which is also its metadata.name. */
  name: string;
  displayName: string;
  description?: string;
  modelUri: string;
  /** Empty for the cluster's default vLLM image, which is for NVIDIA GPUs. */
  runtimeImage: string;
  replicas: number;
  cpu: string;
  memory: string;
  /** The hardware's extended resource to request, such as nvidia.com/gpu; undefined for CPU only. */
  accelerator?: string;
  /** How many of the accelerator to request; 0 asks for none. */
  acceleratorCount: number;
  /**
   * An edit that leaves the model's accelerator requests as they are, whatever `accelerator` says:
   * no hardware is selected and none matches the model, so the wizard shows them read-only.
   */
  keepAccelerators?: boolean;
  /**
   * The environment besides the runtime arguments, sent with them: the hardware's for a new model;
   * for an edit, the model's, with the hardware the user selected applied (envWithHardware).
   */
  env: EnvVar[];
  /** An edit's presets: the model's, or none once the user removes them. A new model has none. */
  baseRefs?: string[];
  runtimeArgs: string[];
  /**
   * The clusters to place the model on, by name, from Models/ListPlacementClusters; not
   * `location` labels, which status.placement.locations reports.
   */
  clusters: string[];
};

/** The placement the console writes: `name In [...]`, the shape git mode takes (ModelSpec.placement). */
export const namedPlacement = (clusters: string[]): PlacementInit => ({
  labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: [...clusters] }] },
});

/** The main container's requests the wizard sets; an accelerator count of 0 asks for none. */
const requestsOf = (input: ModelInput): Record<string, string> => ({
  ...(input.cpu ? { cpu: input.cpu } : {}),
  ...(input.memory ? { memory: input.memory } : {}),
  ...(input.accelerator && input.acceleratorCount > 0 ? { [input.accelerator]: String(input.acceleratorCount) } : {}),
});

export const createRequestOf = (input: ModelInput): MessageInitShape<typeof ModelsCreateRequestSchema> => {
  const displayName = input.displayName.trim();
  return {
    object: {
      id: input.name,
      metadata: {
        name: input.name,
        // Empty ones are left out, as the backend documents the annotations (UI_API_REFERENCE.md).
        annotations: {
          ...(displayName ? { [DISPLAY_NAME]: displayName } : {}),
          ...(input.description ? { [DESCRIPTION]: input.description } : {}),
        },
      },
      spec: {
        // No served name: the backend serves a model as its id, the name users send
        // (ModelSource.name defaults to the id).
        model: { uri: input.modelUri },
        replicas: input.replicas,
        // Preset names carry the OpenShift AI version, so they exist only on clusters with it.
        baseRefs: [],
        main: {
          // Empty: KServe's default preset's image, the cluster's vLLM image for NVIDIA GPUs.
          image: input.runtimeImage.trim(),
          requests: requestsOf(input),
          env: withRuntimeArgs(input.env, input.runtimeArgs),
        },
        // Both set: with the scheduler on, the backend takes managed_route as sent (modelRouterToMap).
        router: { scheduler: true, managedRoute: true },
        placement: namedPlacement(input.clusters),
      },
    },
  };
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);
export const sameSet = (a: string[], b: string[]) => sameList([...a].sort(), [...b].sort());

/** The model's replica count as the wizard starts from it: 1 when it has none stored. */
export const DEFAULT_REPLICAS = 1;

/** Two maps with the same keys and values. */
const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
  sameSet(Object.keys(a), Object.keys(b)) && Object.entries(a).every(([key, value]) => b[key] === value);

/** The variables besides the runtime arguments, in any order, as `name=value`. */
const envEntries = (env: readonly EnvVar[]) =>
  env.filter((v) => v.name !== RUNTIME_ARGS_ENV).map(({ name, value }) => `${name}=${value}`);

/**
 * The main container's requests after an edit: the model's, CPU and memory as entered (empty
 * removes one), and its accelerator requests replaced by the input's unless it keeps them. Every
 * other resource stays as read.
 */
const editedRequests = (model: ModelView, input: ModelInput): Record<string, string> => {
  const requests = { ...model.requests };
  for (const [resource, value] of [
    ['cpu', input.cpu.trim()],
    ['memory', input.memory.trim()],
  ]) {
    if (value) requests[resource] = value;
    else delete requests[resource];
  }
  if (!input.keepAccelerators) {
    for (const { resource } of model.acceleratorRequests) delete requests[resource];
    if (input.accelerator && input.acceleratorCount > 0) requests[input.accelerator] = String(input.acceleratorCount);
  }
  return requests;
};

/**
 * An edit as Models/Update: only the fields the wizard changed, each a path of the mask, at the
 * version the page read (`lock`). The requests, the env and the annotations are whole fields on the
 * wire, so they go back as loaded with the change applied; undefined when nothing changed.
 */
export const updateRequestOf = (
  model: ModelView,
  input: ModelInput,
): MessageInitShape<typeof ModelsUpdateRequestSchema> | undefined => {
  const paths: string[] = [];
  const spec: {
    model?: { uri: string };
    replicas?: number;
    baseRefs?: string[];
    main?: { image?: string; requests?: Record<string, string>; env?: EnvInit[] };
    placement?: PlacementInit;
  } = {};
  let annotations: Record<string, string> | undefined;
  // The URI only: the backend serves a model as its id whatever an update sends (normalizeServedName).
  if (input.modelUri !== (model.modelUri ?? '')) {
    spec.model = { uri: input.modelUri };
    paths.push('spec.model');
  }
  // A model stored without a count shows the default; only a count the user changed is sent.
  if (!model.autoscaled && input.replicas !== (model.replicas ?? DEFAULT_REPLICAS)) {
    spec.replicas = input.replicas;
    paths.push('spec.replicas');
  }
  if (input.baseRefs && !sameList(input.baseRefs, model.baseRefs)) {
    spec.baseRefs = [...input.baseRefs];
    paths.push('spec.base_refs');
  }
  const image = input.runtimeImage.trim();
  if (image !== (model.runtimeImage ?? '')) {
    spec.main = { ...spec.main, image };
    paths.push('spec.main.image');
  }
  // Requests only: the backend gives an accelerator's limit the new request (ModelContainer.requests).
  const requests = editedRequests(model, input);
  if (!sameMap(requests, model.requests)) {
    spec.main = { ...spec.main, requests };
    paths.push('spec.main.requests');
  }
  const argsChanged = !sameList(input.runtimeArgs, runtimeArgsOf(model.env));
  if (argsChanged || !sameSet(envEntries(input.env), envEntries(model.env))) {
    // Unchanged runtime arguments go back as stored, so their spacing doesn't change either.
    const stored = model.env.filter((v) => v.name === RUNTIME_ARGS_ENV).map(({ name, value }) => ({ name, value }));
    const env = argsChanged
      ? withRuntimeArgs(input.env, input.runtimeArgs)
      : [...withRuntimeArgs(input.env, []), ...stored];
    spec.main = { ...spec.main, env };
    paths.push('spec.main.env');
  }
  const displayName = input.displayName.trim();
  if (displayName !== (model.displayName ?? model.id) || (input.description ?? '') !== (model.description ?? '')) {
    annotations = { ...model.annotations };
    // The name field starts from the id when the model has no display name; keeping that default
    // writes nothing, so a description edit doesn't add an annotation nobody set.
    const hadDisplayName = model.annotations[DISPLAY_NAME] !== undefined;
    if (displayName && (hadDisplayName || displayName !== model.id)) annotations[DISPLAY_NAME] = displayName;
    else delete annotations[DISPLAY_NAME];
    if (input.description) annotations[DESCRIPTION] = input.description;
    else delete annotations[DESCRIPTION];
    paths.push('metadata.annotations');
  }
  if (model.placementClusters && !sameSet(input.clusters, model.placementClusters)) {
    spec.placement = namedPlacement(input.clusters);
    paths.push('spec.placement');
  }
  if (paths.length === 0) return undefined;
  return {
    object: {
      id: model.id,
      metadata: { name: model.id, version: model.version, ...(annotations ? { annotations } : {}) },
      spec,
    },
    updateMask: { paths },
    lock: true,
  };
};
