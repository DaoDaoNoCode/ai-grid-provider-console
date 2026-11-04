// What a write sent, in the fields a read-back can compare: a lost answer is confirmed only when the
// object read back holds what this write sent, not merely when it exists or its version moved (the
// same id or a new version can be someone else's write). Each field is a string, so the expected
// ones can be kept in the tab's session storage with the watch.
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ModelSchema, type Model } from '../gen/ai_grid/v1/model_type_pb';
import { SubscriptionSchema, type Subscription } from '../gen/ai_grid/v1/subscription_type_pb';
import { RUNTIME_ARGS_ENV, runtimeArgsOf } from '../pages/models/fields/runtimeArgs';
import { DESCRIPTION, DISPLAY_NAME, placementClustersOf } from '../pages/models/modelView';

export type WriteFields = Record<string, string>;

/** A set of names, as the backend keeps it: sorted, without repeats. */
const asSet = (values: readonly string[]) => JSON.stringify([...new Set(values)].sort());
const entries = (map: { [key: string]: string } | undefined) => JSON.stringify(Object.entries(map ?? {}).sort());
const pick = (all: WriteFields, keys: string[]): WriteFields =>
  Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));

/**
 * A model's fields the console writes: its display name and description, source, presets, image,
 * runtime arguments and the rest of its environment, resources, clusters and replicas.
 */
export const modelFields = (model: Model): WriteFields => {
  const annotations = model.metadata?.annotations ?? {};
  const spec = model.spec;
  return {
    displayName: annotations[DISPLAY_NAME] ?? '',
    description: annotations[DESCRIPTION] ?? '',
    uri: spec?.model?.uri ?? '',
    // The backend keeps the presets and the environment in the order sent (modelSpecToMap,
    // model_mapper.go).
    baseRefs: JSON.stringify(spec?.baseRefs ?? []),
    image: spec?.main?.image ?? '',
    runtimeArgs: JSON.stringify(runtimeArgsOf(spec?.main?.env)),
    env: JSON.stringify(
      (spec?.main?.env ?? []).filter((v) => v.name !== RUNTIME_ARGS_ENV).map((v) => [v.name, v.value]),
    ),
    requests: entries(spec?.main?.requests),
    // The backend sorts the clusters and drops repeats (gitPlacementClusters, models_git.go).
    clusters: asSet(placementClustersOf(spec) ?? []),
    replicas: spec?.replicas === undefined ? '' : String(spec.replicas),
  };
};

/** The fields each path of Models/Update's mask writes (modelRequests.ts, updateRequestOf). */
const modelPathFields: Record<string, string[]> = {
  'metadata.annotations': ['displayName', 'description'],
  'spec.model': ['uri'],
  'spec.replicas': ['replicas'],
  'spec.base_refs': ['baseRefs'],
  'spec.main.image': ['image'],
  'spec.main.requests': ['requests'],
  'spec.main.env': ['runtimeArgs', 'env'],
  'spec.placement': ['clusters'],
};

/** What a Models/Create (no paths) or Models/Update (its mask's paths) sent. */
export const sentModelFields = (object: MessageInitShape<typeof ModelSchema> | undefined, paths?: string[]) => {
  const all = modelFields(create(ModelSchema, object ?? {}));
  return paths
    ? pick(
        all,
        paths.flatMap((p) => modelPathFields[p] ?? []),
      )
    : all;
};

/**
 * The owner groups as the backend keeps them (qualifiedOwnerGroups, subscriptions_git.go): trimmed,
 * qualified with the organization and read back bare, without repeats.
 */
const bareGroups = (groups: readonly string[], organization: string) =>
  groups
    .map((group) => {
      const name = group.trim();
      return organization && name.startsWith(`${organization}/`) ? name.slice(organization.length + 1).trim() : name;
    })
    .filter((name) => name !== '');

/**
 * A subscription's fields the form writes: its display name and description, groups, organization,
 * priority, and each model with its token limits. The backend's joins (a ref's model id and display
 * name) are left out.
 */
export const subscriptionFields = (subscription: Subscription): WriteFields => {
  const annotations = subscription.metadata?.annotations ?? {};
  const spec = subscription.spec;
  const models = [...(spec?.modelRefs ?? [])]
    .map((ref) => ({
      name: ref.name,
      unlimited: ref.unlimited,
      // An unlimited model is stored without token limits (modelRefsToUnstructured).
      limits: ref.unlimited ? [] : ref.tokenRateLimits.map((l) => `${String(l.limit)}/${l.window}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    displayName: annotations[DISPLAY_NAME] ?? '',
    description: annotations[DESCRIPTION] ?? '',
    groups: asSet(bareGroups(spec?.owner?.groups ?? [], spec?.organization?.id ?? '')),
    organization: spec?.organization?.id ?? '',
    priority: String(spec?.priority ?? 0),
    models: JSON.stringify(models),
  };
};

/** The fields each path of Subscriptions/Update's mask writes (CreateSubscriptionForm). */
const subscriptionPathFields: Record<string, string[]> = {
  'metadata.annotations': ['displayName', 'description'],
  spec: ['groups', 'organization', 'priority', 'models'],
};

/** What a Subscriptions/Create (no paths) or Subscriptions/Update (its mask's paths) sent. */
export const sentSubscriptionFields = (
  object: MessageInitShape<typeof SubscriptionSchema> | undefined,
  paths?: string[],
) => {
  const all = subscriptionFields(create(SubscriptionSchema, object ?? {}));
  return paths
    ? pick(
        all,
        paths.flatMap((p) => subscriptionPathFields[p] ?? []),
      )
    : all;
};

/** Whether the object read back holds every field the write sent; a write that sent none matches. */
export const holdsSent = (expected: WriteFields | undefined, actual: WriteFields | undefined) =>
  !expected || Object.entries(expected).every(([key, value]) => actual?.[key] === value);
