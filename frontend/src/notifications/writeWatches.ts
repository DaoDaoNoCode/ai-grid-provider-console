// The checks the notification center runs for a write that outlasted the form: a read-back that
// confirms an unknown outcome, and, for a model, a watch until it is ready on its clusters. Each is
// one call of a NotificationWatcherCallback; the provider (BackgroundWritesProvider) polls it.
import { failureExplanations } from '../pages/models/modelStatusInfo';
import type { ModelView } from '../pages/models/modelView';
import { NotificationResponseStatus, type NotificationWatcherResponse } from './useNotificationWatcher';
import { holdsSent, type WriteFields } from './writeFields';
import {
  READBACK_MINUTES,
  READY_MINUTES,
  goneText,
  mismatchText,
  modelFailedText,
  modelNotReadyText,
  modelReadyText,
  notConfirmedText,
  succeededText,
  unconfirmedText,
  type WriteSubject,
  type WriteTarget,
} from './writeText';

/** How long a write whose outcome is unknown is read back, from when it was sent. */
export const READBACK_MS = READBACK_MINUTES * 60_000;
export const READBACK_POLL_MS = 10_000;
/** How long a deployed model is watched until it is ready, from when the write landed. */
export const READY_MS = READY_MINUTES * 60_000;
/** Each Models/Get reads the Git catalog (seconds on the demo hub), so the ready watch polls slowly. */
export const READY_POLL_MS = 20_000;

/**
 * The object as the backend has it now: its version, the fields a write compares (writeFields.ts),
 * and the model's view for a model.
 */
export type ReadAnswer = { version: number; fields?: WriteFields; model?: ModelView };

/** Reads one object: undefined when the backend says it doesn't exist; throws on any other failure. */
export type ReadObject = (subject: WriteSubject, id: string) => Promise<ReadAnswer | undefined>;

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
    const placed = placedClustersOf(model);
    const failedCluster = placed.find((p) => p.report?.phase === 'Failed');
    if (model.phase === 'Failed' || failedCluster) {
      const known = model.reason ? failureExplanations[model.reason] : undefined;
      const why = failedCluster
        ? `${failedCluster.name}: ${failedCluster.report?.message ?? failedCluster.report?.reason}`
        : (known?.summary ?? model.statusMessage ?? model.reason);
      return error(modelFailedText(target.id, target.name, why));
    }
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
