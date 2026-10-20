// Ported from krisv/ai-grid-cloud-provider-poc src/app/utilities/authpolicies.ts at 62319b8.
// Adapted from opendatahub-io/odh-dashboard
// packages/maas/frontend/src/app/utilities/authpolicies.ts
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
import type { MaaSModelRefSummary } from '../api/types';

export const DEFAULT_MODEL_KIND = 'LLMInferenceService' as const;

type ModelName = { name: string; namespace?: string };

/** Whether two references name the same model: the same namespace and name. */
export const isSameModel = (a: ModelName, b: ModelName): boolean => a.name === b.name && a.namespace === b.namespace;

/** A key for a model reference in sets and React lists. */
export const modelKey = (ref: ModelName): string => `${ref.namespace ?? ''}/${ref.name}`;

/**
 * Resolves bare model refs (name) into full MaaSModelRefSummary objects
 * using the live summaries, falling back to a synthetic entry for deleted models.
 */
export const modelRefsToSummaries = (
  refs: { name: string; namespace?: string; displayName?: string }[],
  summaries: MaaSModelRefSummary[],
): MaaSModelRefSummary[] =>
  refs.map(
    (ref) =>
      summaries.find((c) => isSameModel(c, ref)) ?? {
        name: ref.name,
        namespace: ref.namespace,
        displayName: ref.displayName,
        modelRef: { kind: DEFAULT_MODEL_KIND, name: ref.name },
        notFound: true,
      },
  );
