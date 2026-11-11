// What the Deploy model wizard holds, kept with a deploy so that one the backend refuses after the
// wizard has left (useBackgroundWrites, draftOf) reopens with exactly what was submitted.

/** The wizard's fields as the user left them; undefined for a field still at its default. */
export type ModelDraft = {
  displayName: string;
  name: string;
  description: string;
  modelUri: string;
  /** Undefined in a draft kept before the wizard had the field, which deploys with none. */
  capabilities?: string[];
  replicas: string;
  hardwareId?: string;
  image?: string;
  cpu?: string;
  memory?: string;
  accelerators?: string;
  runtimeArgsEnabled: boolean;
  runtimeArgs: string[];
  clusters: string[];
};

const isString = (value: unknown) => typeof value === 'string';
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isStrings = (value: unknown) => Array.isArray(value) && value.every(isString);

/** A draft in the shape the wizard writes; anything else (another version's, a damaged one) isn't used. */
export const isModelDraft = (value: unknown): value is ModelDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    ['displayName', 'name', 'description', 'modelUri', 'replicas'].every((k) => isString(d[k])) &&
    ['hardwareId', 'image', 'cpu', 'memory', 'accelerators'].every((k) => isOptionalString(d[k])) &&
    (d.capabilities === undefined || isStrings(d.capabilities)) &&
    typeof d.runtimeArgsEnabled === 'boolean' &&
    isStrings(d.runtimeArgs) &&
    isStrings(d.clusters)
  );
};
