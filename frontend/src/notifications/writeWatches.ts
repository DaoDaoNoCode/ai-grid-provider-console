// The checks the notification center runs for a write that outlasted the form: a read-back that
// confirms an unknown outcome, and, for a model, a watch until it is ready on its clusters. Each is
// one call of a NotificationWatcherCallback; the provider (BackgroundWritesProvider) polls it.
import { failureExplanations } from '../pages/models/modelStatusInfo';
import type { ModelView } from '../pages/models/modelView';
import { NotificationResponseStatus, type NotificationWatcherResponse } from './useNotificationWatcher';
import { holdsSent, type WriteFields } from './writeFields';
import {
  READBACK_MINUTES,
  goneText,
  mismatchText,
  modelFailedText,
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
export const READY_MS = 30 * 60_000;
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

/** The clusters a ready model serves on, as its page lists them. */
const readyClustersOf = (model: ModelView) => {
  const ready = model.clusters.filter((c) => c.phase === 'Ready').map((c) => c.cluster);
  return ready.length ? ready : model.selectedClusters;
};

/**
 * A deployed or edited model's status, as the Models list derives it (toModelView): Ready is a
 * success naming its clusters, Failed an error with the reason its page gives; any other phase
 * (Pending, Partially available, Saved to Git, Unknown) is checked again until `since` plus
 * READY_MS, then the watch stops without a word. A model that is gone stops it too.
 */
export const watchReady = async (
  target: WriteTarget,
  since: number,
  read: ReadObject,
  now: () => number,
): Promise<NotificationWatcherResponse> => {
  try {
    const answer = await read('model', target.id);
    const model = answer?.model;
    if (!model) return stop;
    if (model.phase === 'Ready') return success(modelReadyText(target.id, target.name, readyClustersOf(model)));
    if (model.phase === 'Failed') {
      const known = model.reason ? failureExplanations[model.reason] : undefined;
      return error(modelFailedText(target.id, target.name, known?.summary ?? model.statusMessage ?? model.reason));
    }
  } catch {
    // A failed read is checked again, as a page's poll is.
  }
  return now() < since + READY_MS ? repoll : stop;
};
