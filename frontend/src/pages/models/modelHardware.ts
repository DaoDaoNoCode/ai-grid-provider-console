// The Deploy model wizard's Hardware choices, from the console's config (models.hardware, the
// chart's console.models.hardware): what a choice sends, and how the pages word a model's
// accelerators and image. A model is deployed without presets (spec.base_refs): KServe applies its
// default preset, which is for NVIDIA GPUs, then the model's own spec, so the choice's image and
// environment win, and with no image the cluster's default vLLM image for NVIDIA GPUs runs
// (combineBaseRefsConfig in red-hat-data-services/kserve rhoai-3.6,
// pkg/controller/v1alpha2/llmisvc/config_merge.go). That image never becomes ready without NVIDIA
// GPUs, so only NVIDIA hardware may leave the image empty.
//
// A deployed model's pages show it as it is, never matched against today's list: the list can
// change (a new image digest, an entry removed) or fail to load. Only the edit wizard matches it
// (matchingHardware), to preselect the entry it runs on; selecting another entry there
// applies that entry as the Deploy wizard does.
import type { ModelHardware } from '../../api/types';
import { RUNTIME_ARGS_ENV, type EnvVar } from './fields/runtimeArgs';
import type { AcceleratorRequest, ModelView } from './modelView';

/** The extended resources of NVIDIA and AMD GPUs; the clusters' GPU counts are NVIDIA's only. */
export const NVIDIA_GPU = 'nvidia.com/gpu';
const AMD_GPU = 'amd.com/gpu';

const isGPU = (resource: string) => resource === NVIDIA_GPU || resource === AMD_GPU;

/** The accelerator count's label: GPUs for NVIDIA and AMD GPUs, Accelerators for any other. */
export const acceleratorLabel = (resource: string) => (isGPU(resource) ? 'GPUs' : 'Accelerators');

/** What a model without an image or presets runs. */
export const DEFAULT_IMAGE = "Default (the cluster's vLLM image for NVIDIA GPUs)";

/** Whether a model may leave its image empty: only on NVIDIA GPUs, which the default image is for. */
export const mayUseDefaultImage = (accelerator: string | undefined) => accelerator === NVIDIA_GPU;

/** A model's runtime image as the pages show it; undefined for none, with presets that set it. */
export const runtimeImageText = (model: Pick<ModelView, 'runtimeImage' | 'baseRefs'>) =>
  model.runtimeImage ?? (model.baseRefs.length === 0 ? DEFAULT_IMAGE : undefined);

/** The Runtime image field's help where the image may be empty. */
export const DEFAULT_IMAGE_HELP = "Leave empty to use the cluster's default vLLM image for NVIDIA GPUs.";

/** The Runtime image field's help for a new model on this hardware. */
export const runtimeImageHelp = (hardware: ModelHardware | undefined) =>
  hardware?.image
    ? 'Set by the selected hardware. Replace it to use another vLLM image.'
    : mayUseDefaultImage(hardware?.accelerator)
      ? DEFAULT_IMAGE_HELP
      : 'Enter a vLLM image for this hardware.';

/** The hardware's environment variables, as the model's container lists them. */
export const hardwareEnv = (hardware: ModelHardware | undefined): EnvVar[] =>
  Object.entries(hardware?.env ?? {}).map(([name, value]) => ({ name, value }));

const acceleratorText = ({ resource, count }: AcceleratorRequest) => {
  const one = count === '1';
  const noun = isGPU(resource) ? (one ? 'GPU' : 'GPUs') : one ? 'accelerator' : 'accelerators';
  return `${count} ${noun} (${resource})`;
};

/**
 * What a deployed model requests per replica besides CPU and memory, in words: "1 GPU
 * (nvidia.com/gpu)", or "None (CPU only)".
 */
export const acceleratorsText = (model: Pick<ModelView, 'acceleratorRequests'>) =>
  model.acceleratorRequests.map(acceleratorText).join(', ') || 'None (CPU only)';

const QUANTITY_SUFFIX: Record<string, number> = {
  '': 1,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

/**
 * A stored accelerator count as the wizard's whole-number field shows it ("3000m" and "3" are both
 * "3"); undefined for a quantity that isn't a whole number the field can hold.
 */
export const wholeCount = (quantity: string): string | undefined => {
  const match = /^\+?(\d+(?:\.\d*)?|\.\d+)(?:[eE]([-+]?\d+)|(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei))?$/.exec(quantity.trim());
  if (!match) return undefined;
  const [, number, exponent, suffix = ''] = match;
  const value = Number(number) * (exponent !== undefined ? 10 ** Number(exponent) : QUANTITY_SUFFIX[suffix]);
  // Rounding keeps 3000m (3000 * 0.001) a whole 3.
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) && Math.abs(value - rounded) < 1e-9 ? String(rounded) : undefined;
};

/**
 * The first entry of the list a deployed model runs on, which its edit starts on: for an entry with
 * an accelerator, a model that requests that accelerator and no other; for one without, a model
 * that requests none and has each of the entry's environment variables with its value. The image is
 * not compared, so a model with an image of its own still matches its hardware. Undefined when no
 * entry matches, and for a model with presets, whose image and environment come partly from them.
 * Matching selects the entry only; the model keeps its own image, environment and resources.
 */
export const matchingHardware = (
  model: Pick<ModelView, 'acceleratorRequests' | 'env' | 'baseRefs'>,
  list: readonly ModelHardware[],
): ModelHardware | undefined => {
  if (model.baseRefs.length > 0) return undefined;
  const resources = model.acceleratorRequests.map((r) => r.resource);
  return list.find((h) =>
    h.accelerator
      ? resources.length === 1 && resources[0] === h.accelerator
      : resources.length === 0 &&
        Object.entries(h.env ?? {}).every(([name, value]) =>
          model.env.some((v) => v.name === name && v.value === value),
        ),
  );
};

/**
 * A deployed model's environment with this hardware selected in the edit wizard: the variables any
 * entry of the list sets give way to this entry's, and every other variable stays in its place. The
 * runtime arguments are left out; the wizard adds them back.
 */
export const envWithHardware = (
  env: readonly EnvVar[],
  hardware: ModelHardware,
  list: readonly ModelHardware[],
): EnvVar[] => {
  const hardwareNames = new Set(list.flatMap((h) => Object.keys(h.env ?? {})));
  return [
    ...env
      .filter((v) => v.name !== RUNTIME_ARGS_ENV && !hardwareNames.has(v.name))
      .map(({ name, value }) => ({ name, value })),
    ...hardwareEnv(hardware),
  ];
};
