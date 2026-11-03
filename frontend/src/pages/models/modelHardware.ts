// The Deploy model wizard's Hardware choices, from the console's config (models.hardware, the
// chart's console.models.hardware): what a choice sends, how the pages word it, and which choice a
// deployed model matches. A model is deployed without presets (spec.base_refs): KServe applies its
// default preset, which is for NVIDIA GPUs, then the model's own spec, so the choice's image and
// environment win, and with no image the cluster's default vLLM image for NVIDIA GPUs runs
// (combineBaseRefsConfig in red-hat-data-services/kserve rhoai-3.6,
// pkg/controller/v1alpha2/llmisvc/config_merge.go).
import type { ModelHardware } from '../../api/types';
import type { EnvVar } from './fields/runtimeArgs';
import type { ModelView } from './modelView';

/** The extended resources of NVIDIA and AMD GPUs; the clusters' GPU counts are NVIDIA's only. */
export const NVIDIA_GPU = 'nvidia.com/gpu';
const AMD_GPU = 'amd.com/gpu';

/** The accelerator count's label: GPUs for NVIDIA and AMD GPUs, Accelerators for any other. */
export const acceleratorLabel = (resource: string) =>
  resource === NVIDIA_GPU || resource === AMD_GPU ? 'GPUs' : 'Accelerators';

/** What a model without an image or presets runs. */
export const DEFAULT_IMAGE = "Default (the cluster's vLLM image for NVIDIA GPUs)";

/** A model's runtime image as the pages show it; undefined for none, with presets that set it. */
export const runtimeImageText = (model: Pick<ModelView, 'runtimeImage' | 'baseRefs'>) =>
  model.runtimeImage ?? (model.baseRefs.length === 0 ? DEFAULT_IMAGE : undefined);

/** The Runtime image field's help for a new model on this hardware. */
export const runtimeImageHelp = (hardware: ModelHardware | undefined) =>
  hardware?.image
    ? 'Set by the selected hardware. Replace it to use another vLLM image.'
    : !hardware || hardware.accelerator === NVIDIA_GPU
      ? "Leave empty to use the cluster's default vLLM image for NVIDIA GPUs."
      : "Enter a vLLM image for this hardware. If empty, the cluster's default vLLM image for NVIDIA GPUs is used.";

/** The hardware's environment variables, as the model's container lists them. */
export const hardwareEnv = (hardware: ModelHardware | undefined): EnvVar[] =>
  Object.entries(hardware?.env ?? {}).map(([name, value]) => ({ name, value }));

/** Whether the model runs this hardware's image (none for none) and has its environment variables. */
const runsSetupOf = (model: Pick<ModelView, 'runtimeImage' | 'env'>, hardware: ModelHardware) =>
  (hardware.image ?? '') === (model.runtimeImage ?? '') &&
  Object.entries(hardware.env ?? {}).every(([name, value]) =>
    model.env.some((e) => e.name === name && e.value === value),
  );

/**
 * The hardware a deployed model matches, or undefined: a model with presets matches none. A model
 * that requests an accelerator matches the hardware with that accelerator, by its image and
 * environment when more than one has it. A model that requests none matches CPU-only hardware with
 * its image and environment. Anything else, the pages show as the model has it rather than guess.
 */
export const hardwareOf = (
  model: Pick<ModelView, 'baseRefs' | 'acceleratorRequests' | 'runtimeImage' | 'env'>,
  list: readonly ModelHardware[],
): ModelHardware | undefined => {
  if (model.baseRefs.length > 0 || model.acceleratorRequests.length > 1) return undefined;
  const resource = model.acceleratorRequests[0]?.resource ?? '';
  const candidates = list.filter((hardware) => (hardware.accelerator ?? '') === resource);
  if (resource && candidates.length === 1) return candidates[0];
  const matches = candidates.filter((hardware) => runsSetupOf(model, hardware));
  return matches.length === 1 ? matches[0] : undefined;
};

/**
 * A deployed model's hardware in words: the matching hardware's label, else the accelerators it
 * requests by resource name, or No accelerator. Undefined for a model with presets, which the
 * pages show instead.
 */
export const hardwareText = (
  model: Pick<ModelView, 'baseRefs' | 'acceleratorRequests' | 'runtimeImage' | 'env'>,
  list: readonly ModelHardware[],
): string | undefined =>
  model.baseRefs.length > 0
    ? undefined
    : (hardwareOf(model, list)?.label ??
      (model.acceleratorRequests.map((r) => r.resource).join(', ') || 'No accelerator'));
