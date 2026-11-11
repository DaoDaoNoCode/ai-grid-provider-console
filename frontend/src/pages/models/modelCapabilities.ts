// Adapted from odh-dashboard packages/model-serving/src/shared/modelCapabilities.ts and
// deploymentWizard/fields/modelCapabilities/modelCapabilitiesApplyExtract.ts.
// upstream commit: c5a4cb7f466a51578600c94fa2c83a485beb8b27
// A model's capabilities, as OpenShift AI's deployment wizard tags a deployment with them: the
// `opendatahub.io/model-capabilities` annotation, a JSON array of strings. The backend copies a
// model's annotations to its MaaSModelRef and LLMInferenceService (maasModelRefFromModel and
// llmInferenceServiceFromModel, model_mapper.go), where the MaaS portal reads them: a model is
// completion-only, and gets a text completions usage example, when Text completion is the only
// well-known capability it has, none of Chat, Vision and Transcription; other values don't count.
// The well-known values and their colors are OpenShift AI's list (odh-dashboard,
// WELL_KNOWN_MODEL_CAPABILITIES in packages/model-serving/src/shared/modelCapabilities.ts).
// Values are matched trimmed and in any case.
import type { LabelProps } from '@patternfly/react-core';

/** The annotation that lists what a model can do. */
export const MODEL_CAPABILITIES = 'opendatahub.io/model-capabilities';

/** The values the wizard offers, in the order it offers them. */
export const WELL_KNOWN_CAPABILITIES = ['Vision', 'Transcription', 'Chat', 'Text completion'] as const;

/** A value as readers match it: trimmed and lowercase. */
const matched = (value: string) => value.trim().toLowerCase();

const COLORS = new Map<string, LabelProps['color']>([
  ['vision', 'blue'],
  ['transcription', 'orange'],
  ['chat', 'purple'],
  ['text completion', 'teal'],
]);

/** A value's label color: its own for a well-known value, grey for any other. */
export const capabilityColor = (value: string): LabelProps['color'] => COLORS.get(matched(value)) ?? 'grey';

/** Whether the list has the value, matched trimmed and in any case. */
export const includesCapability = (values: string[], value: string) =>
  values.some((v) => matched(v) === matched(value));

/**
 * The annotation's values as written, each once (the first spelling of a value kept); none when the
 * model has no annotation or it isn't a JSON array of strings.
 */
export const capabilitiesOf = (annotations: Record<string, string>): string[] => {
  const raw = annotations[MODEL_CAPABILITIES];
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) return [];
  return parsed.reduce<string[]>((kept, value) => (includesCapability(kept, value) ? kept : [...kept, value]), []);
};

/**
 * Whether an annotation value is one the backend accepts: a JSON array of non-blank strings. It
 * refuses any other on every annotations write (validateGitMetadata, ai-grid-provider-backend).
 */
export const isWellFormedCapabilities = (raw: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string' && v.trim() !== '');
  } catch {
    return false;
  }
};

/** Whether two selections hold the same values, in any order (each holds a value once). */
export const sameCapabilities = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value) => includesCapability(b, value));
