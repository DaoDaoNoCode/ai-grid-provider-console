import type { MaaSWord, ModelClusterView, ModelView, StateWord } from './modelView';

/**
 * What KServe's terminal Ready=False reasons (ConfigNotFound, RefsInvalid, GatewaysNotReady) mean to
 * an administrator, and what to do next. The backend reports them as the model's reason when it reads
 * a live LLMInferenceService (model_mapper.go); in git mode the reasons are its own.
 */
export const failureExplanations: Record<string, { summary: string; next: string }> = {
  ConfigNotFound: {
    summary: 'A runtime template this model needs isn’t installed on the hub.',
    next: 'Install the template on the hub, or deploy the model with another runtime.',
  },
  RefsInvalid: {
    summary: 'The model refers to a resource that doesn’t exist or isn’t valid.',
    next: 'Check the model URI and the runtime, then deploy the model again.',
  },
  GatewaysNotReady: {
    summary: 'The gateway that serves this model isn’t ready.',
    next: 'Check the AI Grid gateway on the hub.',
  },
};

/** What one cluster that isn't ready reported: Argo CD's message for a failed sync, else KServe's, else the backend's. */
const clusterReport = (c: ModelClusterView): string | undefined =>
  (c.syncFailed ? c.syncMessage : undefined) ?? c.deploymentMessage ?? c.syncMessage ?? c.message;

/**
 * The model's rollout as its page explains it (status.state and the placed clusters' reports): for
 * Failed, a sentence and the next step for a failure KServe names (status.reason), else "Unable to
 * deploy this model."; then each placed cluster that isn't Ready, with its word and its report.
 * MaaS isn't here: the page's Availability section says what MaaS reports, so a model starting on
 * its clusters reads Starting even while MaaS failed to publish it. Undefined when there is nothing
 * to explain beyond the word.
 */
export const rolloutExplanation = (
  model: Pick<ModelView, 'state' | 'reason' | 'statusMessage' | 'clusters'>,
): { summary?: string; next?: string; raw?: string; clusters: string[] } | undefined => {
  const failed = model.state === 'Failed';
  const known = failed && model.reason ? failureExplanations[model.reason] : undefined;
  const clusters = model.clusters
    .filter((c) => c.state !== 'Ready')
    .map((c) => {
      const report = clusterReport(c);
      return `${c.cluster}: ${c.state ?? 'Pending sync'}${report ? `. ${report}` : ''}`;
    });
  // A failure KServe names comes with its own words, folded away; a failure the clusters report is
  // in their lines.
  const raw =
    failed && (known || clusters.length === 0) ? [model.reason, model.statusMessage].filter(Boolean).join(': ') : '';
  if (!failed && clusters.length === 0) return undefined;
  return {
    summary: failed ? (known?.summary ?? 'Unable to deploy this model.') : undefined,
    next: known?.next,
    raw: raw || undefined,
    clusters,
  };
};

// The Status and Availability columns follow
// jgiardino/ai-grid-provider-console@a4e6090 modelStatusInfo.ts: the words are the backend's (ModelStatus.state and maas); this file
// only adds their sentences.

/**
 * The Git states' dialog sentences (gitStatusMessage). Saved to Git and Syncing open a dialog with theirs; Synced
 * keeps its sentence for the cluster dialog. The design's Sync now button waits until after the
 * 11-06 freeze.
 */
export const gitStatusMessage: Partial<Record<StateWord, string>> = {
  'Saved to Git':
    'The model configuration has been saved to Git and is waiting for Argo CD to synchronize. Deployment to the target cluster will begin automatically once synced.',
  Syncing:
    'Argo CD is currently synchronizing the model configuration from Git to the target cluster. Cluster deployment will begin shortly.',
  Synced:
    'Argo CD has successfully synchronized configuration manifests to all target clusters. The cluster is now spinning up the model deployment.',
};

/** The model Status labels that open ModelStatusModal: the Git states and Partially ready. */
export const statusOpens = (state: StateWord): boolean =>
  state === 'Partially ready' || state === 'Saved to Git' || state === 'Syncing';

/** The order the Status column sorts by: the rollout from saved to ready, then the rest (stateRank). */
const stateOrder: StateWord[] = [
  'Saved to Git',
  'Syncing',
  'Synced',
  'Starting',
  'Ready',
  'Partially ready',
  'Failed',
  'Stopped',
  'Unknown',
];

export const stateRank = (state: StateWord): number => stateOrder.indexOf(state);

/**
 * The Availability column for one ModelMaasState: a label, the short reason under it, and the
 * dialog's heading, body and links. The copy is the design's examples; the dialog also shows MaaS's
 * own message for each ingress cluster, because MaaS has more pending reasons than this copy names.
 */
export type AvailabilityView = {
  /** Available, Pending, Unavailable or Failed. */
  label: string;
  subtext?: string;
  heading?: string;
  body?: string;
  /** The model needs a subscription: the dialog links to Subscriptions. */
  subscriptionsLink?: boolean;
  /** Availability also waits on the model's clusters: the dialog links to the model's page. */
  modelsLink?: boolean;
};

const availabilityViews: Record<MaaSWord, AvailabilityView> = {
  Available: { label: 'Available' },
  'Awaiting subscription': {
    label: 'Pending',
    subtext: 'Awaiting subscription',
    heading: 'Pending MaaS governance',
    body: 'Consumers can’t access this model yet. To enable access, set up a subscription.',
    subscriptionsLink: true,
  },
  'Awaiting subscription and backend': {
    label: 'Pending',
    subtext: 'Awaiting subscription and backend',
    heading: 'Awaiting subscription and backend',
    body: 'Consumers can’t access this model yet. To enable access, set up a subscription. The model must also be ready on its clusters; its status shows where it isn’t.',
    subscriptionsLink: true,
    modelsLink: true,
  },
  'Configuring routing': {
    label: 'Pending',
    subtext: 'Configuring routing',
    heading: 'Configuring routing',
    body: 'The route for this model is being configured.',
  },
  Unavailable: {
    label: 'Unavailable',
    subtext: 'Endpoint not serving',
    heading: 'Model unavailable',
    body: 'The inference service is not serving requests. The model server might be starting, crashing, or lacking resources.',
  },
  // The design at jgiardino/ai-grid-provider-console@a4e6090 words each failure MaaS reports (Gateway not found, routing configuration failed,
  // unsupported model type); the backend has one FAILED, so the reason is MaaS's message in the dialog.
  Failed: {
    label: 'Failed',
    subtext: 'Setup failed',
    heading: 'Model setup failed',
    body: 'The model could not be configured.',
  },
  Unknown: { label: 'Unknown' },
};

/** The Availability column for the model's MaaS state; undefined while no ingress cluster reports. */
export const availabilityOf = (model: Pick<ModelView, 'maas'>): AvailabilityView | undefined =>
  model.maas ? availabilityViews[model.maas] : undefined;
