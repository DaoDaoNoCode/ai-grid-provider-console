// Writes that may outlast their form. The backend commits Models and Subscriptions to a Git
// repository, which takes seconds and on a slow day longer than the BFF waits. A form waits briefly
// for the answer; past that it leaves as on success and the write goes on here, at the app root:
// its answer, or when the answer is lost, a read-back of the object, becomes a notification. Each
// model deployed is then watched until it is ready, and each subscription created until it is
// active; each model or subscription edited while its changes are applied. The watches are kept
// in the tab's session storage under the signed-in user, so a reload resumes them; they are never
// shared with another tab, user or admin.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Code, ConnectError } from '@connectrpc/connect';
import { createConnectQueryKey, createQueryOptions, useTransport } from '@connectrpc/connect-query';
import { useQueryClient } from '@tanstack/react-query';
import { describeError } from '../api/connect/errors';
import { Models } from '../gen/ai_grid/v1/models_service_pb';
import { get as getModel } from '../gen/ai_grid/v1/models_service-Models_connectquery';
import { Subscriptions } from '../gen/ai_grid/v1/subscriptions_service_pb';
import { get as getSubscription } from '../gen/ai_grid/v1/subscriptions_service-Subscriptions_connectquery';
import { toModelView } from '../pages/models/modelView';
import type { GetStorage } from '../utilities/signInAgain';
import { isObject, readRecords, removeRecords, writeRecords } from './sessionRecords';
import { draftsKey, watchesKey } from './storageKeys';
import { isUnknownOutcome } from './unknownOutcome';
import { BackgroundWritesContext, type BackgroundWritesValue, type WriteDraft } from './useBackgroundWrites';
import { useNotifications } from './useNotifications';
import { NotificationResponseStatus, useNotificationWatcher } from './useNotificationWatcher';
import { modelFields, subscriptionFields } from './writeFields';
import { failedText, pendingText, succeededText, type WriteTarget } from './writeText';
import {
  READBACK_POLL_MS,
  READY_MS,
  READY_POLL_MS,
  nextHistory,
  readBack,
  statusOf,
  watchActive,
  watchChanges,
  watchReady,
  watchSubscriptionChanges,
  type ReadAnswer,
  type ReadObject,
  type SubscriptionHistory,
  type Verdict,
} from './writeWatches';

/**
 * How long a form waits for a write's answer before the notification center takes it over. Long
 * enough for every answer the backend gives without touching Git (a field it refuses, a conflict,
 * a name already taken: well under a second), so those still show on the form; short enough that
 * nobody watches a spinning button and wonders whether their connection broke. Not a test timeout:
 * tests give the provider a wait they end themselves (formWait).
 */
export const FORM_WAIT_MS = 3_000;

const defaultFormWait = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, FORM_WAIT_MS);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });

/**
 * A watch as kept in storage. `sent`: the write's request is out, kept before it was sent; a write
 * whose answer this page no longer awaits (a reload) is read back. `readback`: confirming a write
 * whose answer was lost. `ready`: a deployed model until it is ready (watchReady), a created
 * subscription until it is active (watchActive). `changes`: an edited model while its changes roll
 * out (watchChanges), an edited subscription while they are applied (watchSubscriptionChanges).
 * `notificationId` is the write's in-progress entry, which its outcome replaces. `status`: a status
 * watch's last seen status (statusOf), so a reload still tells a change from none. `empties` and
 * `lastVerdict`: a subscription watch's history (SubscriptionHistory), so a reload goes on counting.
 * `edit`: on a `ready` watch, the latest edit of the object made while it ran (its name and when it
 * landed), which the watch goes on following as a `changes` watch once it ends, until that edit's
 * own READY_MS has run out.
 */
type WatchRecord = WriteTarget & {
  key: string;
  stage: 'sent' | 'readback' | 'ready' | 'changes';
  since: number;
  notificationId?: string;
  status?: string;
  empties?: number;
  lastVerdict?: Verdict;
  edit?: { name: string; since: number };
};

/**
 * The id of a watch's outcome in the notification center when it has no in-progress entry to
 * replace: the same for every run of the watch (its kind, stage, object and start), so an outcome
 * reached again after a reload replaces the first rather than adding a second.
 */
const outcomeId = (record: WatchRecord) => `watch:${record.subject}:${record.stage}:${record.id}:${record.since}`;

const outcomeVariants = {
  [NotificationResponseStatus.SUCCESS]: 'success',
  [NotificationResponseStatus.ERROR]: 'danger',
  [NotificationResponseStatus.WARNING]: 'warning',
} as const;

/** The write a record follows, without the record's own bookkeeping. */
const targetOf = ({ subject, op, id, name, version, expected, clusters, organization }: WatchRecord): WriteTarget => ({
  subject,
  op,
  id,
  name,
  ...(version === undefined ? {} : { version }),
  ...(expected ? { expected } : {}),
  ...(clusters ? { clusters } : {}),
  ...(organization ? { organization } : {}),
});

const historyOf = (record: WatchRecord): SubscriptionHistory => ({
  empties: record.empties ?? 0,
  ...(record.lastVerdict ? { last: record.lastVerdict } : {}),
});

/** The watches that follow an object's status after its write landed. */
const statusStages: ReadonlySet<WatchRecord['stage']> = new Set(['ready', 'changes']);

const isFields = (value: unknown) => isObject(value) && Object.values(value).every((v) => typeof v === 'string');

const isRecord = (value: unknown): value is WatchRecord =>
  isObject(value) &&
  typeof value.key === 'string' &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.since === 'number' &&
  Number.isFinite(value.since) &&
  (value.version === undefined || typeof value.version === 'number') &&
  (value.expected === undefined || isFields(value.expected)) &&
  (value.notificationId === undefined || typeof value.notificationId === 'string') &&
  (value.status === undefined || typeof value.status === 'string') &&
  (value.organization === undefined || typeof value.organization === 'string') &&
  (value.empties === undefined ||
    (typeof value.empties === 'number' && Number.isInteger(value.empties) && value.empties >= 0)) &&
  (value.lastVerdict === undefined ||
    value.lastVerdict === 'active' ||
    value.lastVerdict === 'policy' ||
    value.lastVerdict === 'subscription') &&
  (value.edit === undefined ||
    (isObject(value.edit) &&
      typeof value.edit.name === 'string' &&
      typeof value.edit.since === 'number' &&
      Number.isFinite(value.edit.since))) &&
  (value.clusters === undefined ||
    (Array.isArray(value.clusters) && value.clusters.every((c) => typeof c === 'string'))) &&
  (value.subject === 'model' || value.subject === 'subscription') &&
  (value.op === 'create' || value.op === 'update' || value.op === 'delete') &&
  (value.stage === 'sent' || value.stage === 'readback' || value.stage === 'ready' || value.stage === 'changes');

/** The refused creates whose input the tab keeps, newest last. */
const MAX_DRAFTS = 10;

const isDraft = (value: unknown): value is WriteDraft =>
  isObject(value) &&
  typeof value.key === 'string' &&
  (value.subject === 'model' || value.subject === 'subscription') &&
  typeof value.error === 'string' &&
  value.values !== undefined;

let counter = 0;
const newKey = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

type Props = {
  children: React.ReactNode;
  storage: GetStorage;
  /**
   * The signed-in user, whose watches these are: storage is read and kept only once it is known,
   * and when it changes the previous user's watches stop and leave the tab.
   */
  owner?: string;
  /** Resolves when the form has waited long enough (FORM_WAIT_MS); a test ends it itself. */
  formWait?: (signal: AbortSignal) => Promise<void>;
  /** For tests. */
  now?: () => number;
};

export const BackgroundWritesProvider: React.FC<Props> = ({
  children,
  storage,
  owner,
  formWait = defaultFormWait,
  now = Date.now,
}) => {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const { registerNotification, unregisterNotification } = useNotificationWatcher();
  // Every watch this provider holds, in memory; storage only mirrors it for a reload.
  const records = useRef<WatchRecord[]>([]);
  // The user the records belong to, as the effect below last saw it.
  const ownerRef = useRef<string>(undefined);
  const mounted = useRef(false);
  // Moves on when the user changes, so a write the previous user started reports nothing.
  const generation = useRef(0);
  // The watches registered with the watcher, and the writes whose answer this page still awaits.
  // Sets that live as long as the provider, so an effect's cleanup reads the same ones.
  const registered = useRef(new Set<string>());
  // Each status watch's last seen status (statusOf), to refresh the pages only on a change.
  const lastStatus = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());

  const save = useCallback(() => {
    if (ownerRef.current !== undefined) writeRecords(storage, watchesKey(ownerRef.current), records.current);
  }, [storage]);
  const drop = useCallback(
    (key: string) => {
      records.current = records.current.filter((r) => r.key !== key);
      save();
    },
    [save],
  );
  const keep = useCallback(
    (record: WatchRecord) => {
      records.current = [...records.current.filter((r) => r.key !== record.key), record];
      save();
    },
    [save],
  );

  // What refused creates submitted, newest last, so the form reopens with them (draftOf); in memory
  // and mirrored to the tab's storage under the user, like the watches.
  const drafts = useRef<WriteDraft[]>([]);
  const keepDraft = useCallback(
    (draft: WriteDraft) => {
      drafts.current = [...drafts.current.filter((d) => d.key !== draft.key), draft].slice(-MAX_DRAFTS);
      if (ownerRef.current !== undefined) writeRecords(storage, draftsKey(ownerRef.current), drafts.current);
    },
    [storage],
  );

  // Reads go through the query cache, so a watch and a page showing the same object share them.
  const read = useCallback<ReadObject>(
    async (subject, id) => {
      try {
        if (subject === 'model') {
          const { object } = await queryClient.fetchQuery({
            ...createQueryOptions(getModel, { id }, { transport }),
            staleTime: 0,
            retry: false,
          });
          return (
            object && {
              version: object.metadata?.version ?? 0,
              fields: modelFields(object),
              model: toModelView(object),
            }
          );
        }
        const { object, authPolicies } = await queryClient.fetchQuery({
          ...createQueryOptions(getSubscription, { id }, { transport }),
          staleTime: 0,
          retry: false,
        });
        return (
          object && {
            version: object.metadata?.version ?? 0,
            fields: subscriptionFields(object),
            subscription: {
              phase: object.status?.phase.trim() ?? '',
              policies: authPolicies.map((p) => ({ id: p.id, phase: p.phase.trim() })),
            },
          }
        );
      } catch (err) {
        if (ConnectError.from(err).code === Code.NotFound) return undefined;
        throw err;
      }
    },
    [queryClient, transport],
  );

  const { startWatch, landed } = useMemo(() => {
    /**
     * A watch registered with the watcher; a final answer drops its record, unless the console
     * unmounted meanwhile (a reload), which leaves it for the next page to resume.
     */
    function startWatchFn(record: WatchRecord) {
      keep(record);
      const { key, stage, since, notificationId, status: kept } = record;
      const target = targetOf(record);
      const followsStatus = statusStages.has(stage);
      const isModel = target.subject === 'model';
      registered.current.add(key);
      if (kept !== undefined) lastStatus.current.set(key, kept);
      // The subscription watch's history, as its record has it (a reload goes on from it).
      let history = historyOf(record);
      registerNotification({
        id: key,
        notificationId,
        callbackDelay: followsStatus ? READY_POLL_MS : READBACK_POLL_MS,
        callback: async (signal) => {
          // What this poll read, to tell whether the object changed since the last one.
          const seen: { answered: boolean; answer?: ReadAnswer } = { answered: false };
          const observe: ReadObject = async (subject, id) => {
            const answer = await read(subject, id);
            seen.answered = true;
            seen.answer = answer;
            return answer;
          };
          const before = lastStatus.current.get(key);
          const response =
            stage === 'ready'
              ? isModel
                ? await watchReady(target, since, observe, now)
                : await watchActive(target, since, observe, now, history)
              : stage === 'changes'
                ? isModel
                  ? await watchChanges(target, since, observe, now, before)
                  : await watchSubscriptionChanges(target, since, observe, now, history)
                : await readBack(target, since, observe, now);
          if (signal.aborted) return response;
          const final = response.status !== NotificationResponseStatus.REPOLL;
          // A status watch that sees the object's status change (a model's phase or any cluster's,
          // a subscription's phase or its policy's) has every page showing objects of its kind
          // refetch at once, rather than on its next poll; so does any watch that ends. A poll that
          // sees no change refetches nothing.
          let changed = false;
          if (followsStatus && seen.answered) {
            const status = statusOf(seen.answer);
            const nextStatusHistory = nextHistory(history, seen.answer);
            changed = before !== undefined && before !== status;
            lastStatus.current.set(key, status);
            const historyMoved =
              nextStatusHistory.empties !== history.empties || nextStatusHistory.last !== history.last;
            history = nextStatusHistory;
            if (!final && (status !== before || historyMoved)) {
              keep({
                ...(records.current.find((r) => r.key === key) ?? record),
                status,
                empties: history.empties,
                ...(history.last ? { lastVerdict: history.last } : {}),
              });
            }
          }
          if (final || changed) refreshFn(target.subject);
          if (final) {
            // The outcome goes to the notification center, which keeps it in storage at once,
            // before the watch's record goes: a reload in between resumes the watch, which comes to
            // the same outcome and replaces this entry (the same id), rather than losing both. The
            // watcher is then told to stop, so it raises nothing of its own.
            if (response.status !== NotificationResponseStatus.STOP) {
              notify({
                id: notificationId ?? outcomeId(record),
                variant: outcomeVariants[response.status],
                title: response.title,
                message: response.message,
                actions: response.actions,
              });
            }
            const current = records.current.find((r) => r.key === key) ?? record;
            const seenStatus = lastStatus.current.get(key);
            lastStatus.current.delete(key);
            registered.current.delete(key);
            // A create's watch that reached its own end (ready or active, failed, or out of time)
            // while an edit made meanwhile still has time goes on following the object for that
            // edit, silently, until the edit's READY_MS runs out. A watch that stopped (the object is
            // gone, or no status) has nothing to follow.
            const edit = current.edit;
            if (
              stage === 'ready' &&
              response.status !== NotificationResponseStatus.STOP &&
              edit &&
              now() < edit.since + READY_MS
            ) {
              startWatchFn({
                ...targetOf(current),
                op: 'update',
                name: edit.name,
                key: newKey(),
                stage: 'changes',
                since: edit.since,
                ...(seenStatus === undefined ? {} : { status: seenStatus }),
                empties: history.empties,
                ...(history.last ? { lastVerdict: history.last } : {}),
              });
            }
            drop(key);
            if (response.status === NotificationResponseStatus.SUCCESS && !followsStatus) {
              landedFn(target);
            }
            return { status: NotificationResponseStatus.STOP };
          }
          return response;
        },
      });
    }
    /**
     * A write that landed: the pages refetch, and the object's status is followed. One watch per
     * model and per subscription, so nothing is said twice:
     * - a deploy is watched until the model is ready, a create until the subscription is active,
     *   replacing any earlier watch of the id (an object deleted and created again within the
     *   first's 30 minutes);
     * - an edit is watched while its changes are applied (watchChanges, watchSubscriptionChanges:
     *   never "ready" or "active", as the status doesn't say which version it describes),
     *   replacing the previous edit's watch; while a create's readiness watch of the object still
     *   runs, that one goes on as the one watch, as it follows the same status (and, for a model,
     *   reports the same failures), and records the edit: when it ends, it goes on as the edit's
     *   watch until the edit's own 30 minutes run out;
     * - a delete stops the object's watches at once.
     */
    function landedFn(target: WriteTarget) {
      refreshFn(target.subject);
      const watches = records.current.filter(
        (r) => statusStages.has(r.stage) && r.subject === target.subject && r.id === target.id,
      );
      const ready = watches.find((r) => r.stage === 'ready');
      if (target.op === 'update' && ready) {
        keep({ ...ready, edit: { name: target.name, since: now() } });
        return;
      }
      for (const earlier of watches) {
        unregisterNotification(earlier.key);
        registered.current.delete(earlier.key);
        lastStatus.current.delete(earlier.key);
        drop(earlier.key);
      }
      if (target.op === 'delete') return;
      startWatchFn({ ...target, key: newKey(), stage: target.op === 'create' ? 'ready' : 'changes', since: now() });
    }
    /** Every page showing objects of this kind refetches them: the lists and each one's Get. */
    function refreshFn(subject: WriteTarget['subject']) {
      const schema = subject === 'model' ? Models : Subscriptions;
      void queryClient.invalidateQueries({ queryKey: createConnectQueryKey({ schema, cardinality: undefined }) });
    }
    return { startWatch: startWatchFn, landed: landedFn };
  }, [keep, drop, read, now, notify, registerNotification, unregisterNotification, queryClient]);

  // Storage is read once per user: when the user is first known (a reload resumes that user's
  // watches) and when it changes (the previous user's watches stop and leave the tab). Every run,
  // a transport change included, registers the watches again from memory; a write whose answer
  // this page still awaits keeps it, and one it no longer awaits (a reload) is read back.
  useEffect(() => {
    mounted.current = true;
    if (owner !== ownerRef.current) {
      const previous = ownerRef.current;
      ownerRef.current = owner;
      if (previous !== undefined) {
        generation.current += 1;
        inFlight.current.clear();
        records.current = [];
        drafts.current = [];
        removeRecords(storage, watchesKey(previous));
        removeRecords(storage, draftsKey(previous));
      }
      if (owner !== undefined) {
        const stored = readRecords(storage, watchesKey(owner), isRecord);
        const held = records.current;
        records.current = [...held, ...stored.filter((s) => !held.some((r) => r.key === s.key))];
        save();
        const storedDrafts = readRecords(storage, draftsKey(owner), isDraft);
        drafts.current = [
          ...drafts.current,
          ...storedDrafts.filter((s) => !drafts.current.some((d) => d.key === s.key)),
        ];
      }
    }
    const watching = registered.current;
    for (const record of [...records.current]) {
      if (inFlight.current.has(record.key)) continue;
      startWatch(record.stage === 'sent' ? { ...record, stage: 'readback' } : record);
    }
    return () => {
      mounted.current = false;
      for (const key of watching) unregisterNotification(key);
      watching.clear();
    };
  }, [owner, storage, save, startWatch, unregisterNotification]);

  const submitWrite = useCallback<BackgroundWritesValue['submitWrite']>(
    async ({ draft, ...target }, send) => {
      const sentAt = now();
      const key = newKey();
      const started = generation.current;
      // Kept before the request goes out: a reload during the form's wait reads the write back.
      inFlight.current.add(key);
      keep({ ...target, key, stage: 'sent', since: sentAt });
      const answer = send().then(
        () => ({ ok: true }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      );
      const waited = new AbortController();
      const first = await Promise.race([answer, formWait(waited.signal).then(() => undefined)]);
      waited.abort();

      // The page is gone (its record is read back after the reload), or another user signed in.
      const current = () => mounted.current && started === generation.current;
      const handOver = () => notify({ variant: 'info', ...pendingText(target), read: true });

      if (first) {
        if (!current()) return 'pending';
        inFlight.current.delete(key);
        if (first.ok) {
          drop(key);
          // In answer to the user's own click: kept in the drawer as read.
          notify({ variant: 'success', ...succeededText(target), read: true });
          landed(target);
          return 'done';
        }
        // Any answer within the wait is the form's, as before the notification center, whatever its
        // code: an Unavailable backend is the form's error too. Only a write still unanswered when
        // the wait ends is handed over.
        drop(key);
        throw first.error;
      }

      // Still running: the form leaves, and the answer becomes the outcome of the in-progress entry,
      // unless the page is gone or another user signed in meanwhile: nothing of this write may reach
      // that user's notifications or storage.
      if (!current()) return 'pending';
      const notificationId = handOver();
      keep({ ...target, key, stage: 'sent', since: sentAt, notificationId });
      void answer.then((result) => {
        inFlight.current.delete(key);
        if (!current()) return;
        if (result.ok) {
          drop(key);
          notify({ id: notificationId, variant: 'success', ...succeededText(target) });
          landed(target);
        } else if (isUnknownOutcome(result.error)) {
          startWatch({ ...target, key, stage: 'readback', since: sentAt, notificationId });
        } else {
          // Refused after the form left: a create keeps what was submitted, so the toast's link
          // reopens the form with it and the refusal (draftOf).
          drop(key);
          const message = describeError(result.error).message;
          if (draft !== undefined && target.op === 'create') {
            keepDraft({ key, subject: target.subject, values: draft, error: message });
          }
          notify({
            id: notificationId,
            variant: 'danger',
            ...failedText(target, message, draft !== undefined && target.op === 'create' ? key : undefined),
          });
        }
      });
      return 'pending';
    },
    [now, formWait, notify, startWatch, landed, keep, drop, keepDraft],
  );

  const draftOf = useCallback((id: string) => drafts.current.find((d) => d.key === id), []);

  const value = useMemo(() => ({ submitWrite, draftOf }), [submitWrite, draftOf]);
  return <BackgroundWritesContext.Provider value={value}>{children}</BackgroundWritesContext.Provider>;
};
