// The checks the notification center runs for a write that outlasted the form: a read-back that
// confirms an unknown outcome; for a model, a watch until it is ready on its clusters (a deploy)
// or while its changes roll out (an edit); for a subscription, a watch until it is active on the
// ingress clusters (a create) or while its changes are applied (an edit). Each is one call of a
// NotificationWatcherCallback; the provider (BackgroundWritesProvider) polls it.
import { failureExplanations } from '../pages/models/modelStatusInfo';
import type { ModelView } from '../pages/models/modelView';
import { NotificationResponseStatus, type NotificationWatcherResponse } from './useNotificationWatcher';
import { holdsSent, type WriteFields } from './writeFields';
import {
  READBACK_MINUTES,
  READY_MINUTES,
  goneText,
  mismatchText,
  modelChangesFailedText,
  modelFailedText,
  modelNotReadyText,
  modelReadyText,
  notConfirmedText,
  subscriptionActiveText,
  subscriptionNotActiveText,
  succeededText,
  unconfirmedText,
  type WriteSubject,
  type WriteTarget,
} from './writeText';

/** How long a write whose outcome is unknown is read back, from when it was sent. */
export const READBACK_MS = READBACK_MINUTES * 60_000;
export const READBACK_POLL_MS = 10_000;
/**
 * How long a deployed model is watched until it is ready, a created subscription until it is
 * active, and an edited one of either at all, from when the write landed.
 */
export const READY_MS = READY_MINUTES * 60_000;
/**
 * Each Models/Get and Subscriptions/Get reads the Git catalog (seconds on the demo hub), so the
 * status watches poll slowly.
 */
export const READY_POLL_MS = 20_000;
/**
 * How long a subscription watch goes on while the phase reads empty, from when the write landed:
 * three reads. An empty phase means no ingress cluster reports any status at all (the status
 * Policy isn't deployed, or no cluster has evaluated it; withSubscriptionPhase in the backend's
 * internal/servers/subscriptions_git.go), which no write changes, so waiting longer tells nothing.
 */
export const NO_STATUS_MS = 2 * READY_POLL_MS;

/**
 * A subscription's status as its watches read it from Subscriptions/Get: its phase, and its
 * authorization policies' (the managed `<id>-policy`, the one Get returns in git mode). Each phase
 * is Active, Pending, or empty when no ingress cluster reports.
 */
export type SubscriptionStatusView = { phase: string; policies: { id: string; phase: string }[] };

/**
 * The object as the backend has it now: its version, the fields a write compares (writeFields.ts),
 * and the model's view for a model, the status for a subscription.
 */
export type ReadAnswer = {
  version: number;
  fields?: WriteFields;
  model?: ModelView;
  subscription?: SubscriptionStatusView;
};

/** Reads one object: undefined when the backend says it doesn't exist; throws on any other failure. */
export type ReadObject = (subject: WriteSubject, id: string) => Promise<ReadAnswer | undefined>;

/**
 * An object's status as the status watches compare it: a model's phase and reason, and each
 * cluster's; a subscription's phase and its policies'; "gone" when the object is. A change is what
 * has the pages refetch, and what a model edit's watch reports a failure on.
 */
export const statusOf = (answer: ReadAnswer | undefined) => {
  if (answer?.model) {
    return JSON.stringify([
      answer.model.phase,
      answer.model.reason,
      answer.model.clusters.map((c) => [c.cluster, c.phase, c.reason]),
    ]);
  }
  if (answer?.subscription) {
    return JSON.stringify([answer.subscription.phase, answer.subscription.policies.map((p) => [p.id, p.phase])]);
  }
  return 'gone';
};

type Text = { title: string; message?: string; actions?: { title: string; to: string }[] };
const repoll = { status: NotificationResponseStatus.REPOLL } as const;
const stop = { status: NotificationResponseStatus.STOP } as const;
const success = (text: Text) => ({ status: NotificationResponseStatus.SUCCESS, ...text }) as const;
const error = (text: Text) => ({ status: NotificationResponseStatus.ERROR, ...text }) as const;
const warning = (text: Text) => ({ status: NotificationResponseStatus.WARNING, ...text }) as const;

/**
 * Whether a write whose answer never came landed. A create is confirmed when the object exists and
 * holds what it sent; an update when its version moved on from the one sent and the object holds
 * what it sent; a delete when the object is gone. An object that exists, or moved on, with other
 * content is someone else's write as far as anyone can tell: a warning that the write couldn't be
 * confirmed. Until `sentAt` plus READBACK_MS it checks again; then the write is reported as not
 * done, or, when the reads themselves kept failing, as unknown (a warning too).
 */
export const readBack = async (
  target: WriteTarget,
  sentAt: number,
  read: ReadObject,
  now: () => number,
): Promise<NotificationWatcherResponse> => {
  let readFailed = false;
  try {
    const answer = await read(target.subject, target.id);
    switch (target.op) {
      case 'create':
        if (answer) {
          return holdsSent(target.expected, answer.fields)
            ? success(succeededText(target))
            : warning(mismatchText(target));
        }
        break;
      case 'update':
        if (!answer) return error(goneText(target));
        if (answer.version !== target.version) {
          return holdsSent(target.expected, answer.fields)
            ? success(succeededText(target))
            : warning(mismatchText(target));
        }
        break;
      case 'delete':
        if (!answer) return success(succeededText(target));
        break;
    }
  } catch {
    readFailed = true;
  }
  if (now() < sentAt + READBACK_MS) return repoll;
  return readFailed ? warning(unconfirmedText(target)) : error(notConfirmedText(target));
};

/**
 * Each cluster the model is placed on (placement.selected_clusters), with its report from
 * `status.clusters`: one entry per placed cluster, READY once that cluster's LLMInferenceService is
 * Ready. A cluster that hasn't reported has no entry yet, and isn't ready.
 */
const placedClustersOf = (model: ModelView) => {
  const reports = new Map(model.clusters.map((c) => [c.cluster, c]));
  const names = model.selectedClusters.length ? model.selectedClusters : model.clusters.map((c) => c.cluster);
  return names.map((name) => ({ name, report: reports.get(name) }));
};

/**
 * Why a model failed, when the backend calls it Failed or reports a cluster it is placed on failed
 * (git mode reports none today): the cluster and its message, else the model's page's words for a
 * known reason, else the backend's message. Undefined while it hasn't failed.
 */
const failureOf = (model: ModelView): { why: string | undefined } | undefined => {
  const failedCluster = placedClustersOf(model).find((p) => p.report?.phase === 'Failed');
  if (model.phase !== 'Failed' && !failedCluster) return undefined;
  const known = model.reason ? failureExplanations[model.reason] : undefined;
  return {
    why: failedCluster
      ? `${failedCluster.name}: ${failedCluster.report?.message ?? failedCluster.report?.reason}`
      : (known?.summary ?? model.statusMessage ?? model.reason),
  };
};

/**
 * A deployed model until it runs on every cluster it is placed on. Ready is read per cluster, from
 * `status.clusters`, not from the model's overall phase: the overall phase also counts the ingress
 * clusters that publish the model through MaaS, whose report turns ready only once a subscription
 * covers the model, so a model running on its clusters can read Pending for good. "Ready" here means
 * running on its clusters; users reach it through MaaS once a subscription covers it too.
 *
 * Every placed cluster ready is a success naming them; a model the backend calls Failed, or a
 * cluster it reports failed (git mode reports none today), an error. Anything else is checked again
 * until `since` plus READY_MS, then a warning names the clusters it isn't ready on. A model that is
 * gone stops the watch. A model on the hub alone, with no placed cluster, is ready when its phase is.
 */
export const watchReady = async (
  target: WriteTarget,
  since: number,
  read: ReadObject,
  now: () => number,
): Promise<NotificationWatcherResponse> => {
  let waiting: string[] = [];
  try {
    const answer = await read('model', target.id);
    const model = answer?.model;
    if (!model) return stop;
    const failure = failureOf(model);
    if (failure) return error(modelFailedText(target.id, target.name, failure.why));
    const placed = placedClustersOf(model);
    if (placed.length === 0) {
      if (model.phase === 'Ready') return success(modelReadyText(target.id, target.name, []));
    } else {
      waiting = placed.filter((p) => p.report?.phase !== 'Ready').map((p) => p.name);
      if (waiting.length === 0) {
        return success(
          modelReadyText(
            target.id,
            target.name,
            placed.map((p) => p.name),
          ),
        );
      }
    }
  } catch {
    // A failed read is checked again, as a page's poll is.
  }
  return now() < since + READY_MS ? repoll : warning(modelNotReadyText(target.id, target.name, waiting));
};

/**
 * An edited model while its changes roll out, until `since` plus READY_MS; then it ends silently. It
 * never says "ready": the status doesn't say which revision it describes, and during a rolling update
 * the previous pod keeps its cluster Ready. It reports one thing, a failure, and only one it saw
 * happen: `before` is the status the watch saw last (statusOf), none on its first read, which comes
 * as the edit lands, before Argo CD can have applied it. A model already failed then is the previous
 * revision's failure, reported only once its status changes (a new failure). A model that is gone
 * stops the watch.
 */
export const watchChanges = async (
  target: WriteTarget,
  since: number,
  read: ReadObject,
  now: () => number,
  before: string | undefined,
): Promise<NotificationWatcherResponse> => {
  try {
    const answer = await read('model', target.id);
    const model = answer?.model;
    if (!model) return stop;
    const failure = failureOf(model);
    if (failure && before !== undefined && statusOf(answer) !== before) {
      return error(modelChangesFailedText(target.id, target.name, failure.why));
    }
  } catch {
    // A failed read is checked again, as a page's poll is.
  }
  return now() < since + READY_MS ? repoll : stop;
};

/** Whether a subscription's phase reads empty: no ingress cluster reports any status (NO_STATUS_MS). */
const noStatus = (status: SubscriptionStatusView) => status.phase === '';

/**
 * A created subscription until it is active on every ingress cluster. The backend reads both
 * phases from the clusters' reports (withSubscriptionPhase and withAuthPolicyStatus, its
 * internal/servers/subscriptions_git.go): Active when every ingress cluster has the object active,
 * Pending while any doesn't have it yet, has it otherwise, or hasn't reported. There is no Failed:
 * a subscription the cluster can't make active reads Pending.
 *
 * Active needs the authorization policy Active too: in MaaS the policy gives the users access to
 * the models and the subscription their quota, and a user needs both. Both active is a success;
 * anything else is checked again until `since` plus READY_MS, then a warning says which of the two
 * isn't active. An empty phase claims nothing either way: the watch stops silently once it has read
 * one for NO_STATUS_MS. A subscription that is gone stops the watch.
 */
export const watchActive = async (
  target: WriteTarget,
  since: number,
  read: ReadObject,
  now: () => number,
): Promise<NotificationWatcherResponse> => {
  let inactive: 'subscription' | 'policy' = 'subscription';
  try {
    const status = (await read('subscription', target.id))?.subscription;
    if (!status) return stop;
    if (noStatus(status)) return now() < since + NO_STATUS_MS ? repoll : stop;
    if (status.phase === 'Active') {
      if (status.policies.every((p) => p.phase === 'Active')) return success(subscriptionActiveText(target));
      inactive = 'policy';
    }
  } catch {
    // A failed read is checked again, as a page's poll is.
  }
  return now() < since + READY_MS ? repoll : warning(subscriptionNotActiveText(target, inactive));
};

/**
 * An edited subscription while the ingress clusters apply its changes, until `since` plus READY_MS;
 * then it ends silently. It says nothing: Active doesn't say which version it describes (the
 * clusters' reports name objects, not versions, and the previous version stays active while the
 * new one is applied), and a subscription has no Failed phase to report. It is there so the pages
 * refetch when the phase changes. An empty phase stops it after NO_STATUS_MS, as in watchActive;
 * a subscription that is gone stops it.
 */
export const watchSubscriptionChanges = async (
  target: WriteTarget,
  since: number,
  read: ReadObject,
  now: () => number,
): Promise<NotificationWatcherResponse> => {
  try {
    const status = (await read('subscription', target.id))?.subscription;
    if (!status) return stop;
    if (noStatus(status) && now() >= since + NO_STATUS_MS) return stop;
  } catch {
    // A failed read is checked again, as a page's poll is.
  }
  return now() < since + READY_MS ? repoll : stop;
};
