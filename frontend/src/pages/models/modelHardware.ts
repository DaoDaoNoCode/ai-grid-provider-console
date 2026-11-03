// The Deploy model wizard's Hardware choices, from the console's config (models.hardware, the
// chart's console.models.hardware): what a choice sends, and how the pages word a model's
// accelerators and image. A model is deployed without presets (spec.base_refs): KServe applies its
// default preset, which is for NVIDIA GPUs, then the model's own spec, so the choice's image and
// environment win, and with no image the cluster's default vLLM image for NVIDIA GPUs runs
// (combineBaseRefsConfig in red-hat-data-services/kserve rhoai-3.6,
// pkg/controller/v1alpha2/llmisvc/config_merge.go). That image never becomes ready without NVIDIA
// GPUs, so only NVIDIA hardware may leave the image empty.
//
// A deployed model is shown as it is, never matched against today's list: the list can change (a
// new image digest, an entry removed) or fail to load.
import type { ModelHardware } from '../../api/types';
import type { EnvVar } from './fields/runtimeArgs';
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
