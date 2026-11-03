// Writes that may outlast their form. The backend commits Models and Subscriptions to a Git
// repository, which takes seconds and on a slow day longer than the BFF waits. A form waits briefly
// for the answer; past that it leaves as on success and the write goes on here, at the app root:
// its answer, or when the answer is lost, a read-back of the object, becomes a notification. Each
// model deployed is then watched until it is ready. The watches are kept in the tab's session
// storage under the signed-in user, so a reload resumes them; they are never shared with another
// tab, user or admin.
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
import { watchesKey } from './storageKeys';
import { isUnknownOutcome } from './unknownOutcome';
import { BackgroundWritesContext, type BackgroundWritesValue } from './useBackgroundWrites';
import { useNotifications } from './useNotifications';
import { NotificationResponseStatus, useNotificationWatcher } from './useNotificationWatcher';
import { modelFields, subscriptionFields } from './writeFields';
import { failedText, pendingText, succeededText, type WriteTarget } from './writeText';
import { READBACK_POLL_MS, READY_POLL_MS, readBack, watchReady, type ReadObject } from './writeWatches';

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
 * whose answer was lost. `ready`: a deployed model, until it is ready. `notificationId` is the
 * write's in-progress entry, which its outcome replaces.
 */
type WatchRecord = WriteTarget & {
  key: string;
  stage: 'sent' | 'readback' | 'ready';
  since: number;
  notificationId?: string;
};

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
  (value.subject === 'model' || value.subject === 'subscription') &&
  (value.op === 'create' || value.op === 'update' || value.op === 'delete') &&
  (value.stage === 'sent' || value.stage === 'readback' || value.stage === 'ready');

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
        const { object } = await queryClient.fetchQuery({
          ...createQueryOptions(getSubscription, { id }, { transport }),
          staleTime: 0,
          retry: false,
        });
        return object && { version: object.metadata?.version ?? 0, fields: subscriptionFields(object) };
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
      const { key, stage, since, notificationId, ...target } = record;
      registered.current.add(key);
      registerNotification({
        id: key,
        notificationId,
        callbackDelay: stage === 'ready' ? READY_POLL_MS : READBACK_POLL_MS,
        callback: async (signal) => {
          const response =
            stage === 'ready' ? await watchReady(target, since, read, now) : await readBack(target, since, read, now);
          if (!signal.aborted && response.status !== NotificationResponseStatus.REPOLL) {
            registered.current.delete(key);
            drop(key);
            if (response.status === NotificationResponseStatus.SUCCESS && stage !== 'ready') {
              landedFn(target);
            }
          }
          return response;
        },
      });
    }
    /**
     * A write that landed: the pages refetch, and a deployed model is watched until it is ready. An
     * edited one isn't: its status doesn't say which revision it describes, so the previous
     * deployment's Ready would read as the edit's.
     */
    function landedFn(target: WriteTarget) {
      const schema = target.subject === 'model' ? Models : Subscriptions;
      void queryClient.invalidateQueries({ queryKey: createConnectQueryKey({ schema, cardinality: undefined }) });
      if (target.subject === 'model' && target.op === 'create') {
        startWatchFn({ ...target, key: newKey(), stage: 'ready', since: now() });
      }
    }
    return { startWatch: startWatchFn, landed: landedFn };
  }, [keep, drop, read, now, registerNotification, queryClient]);

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
        removeRecords(storage, watchesKey(previous));
      }
      if (owner !== undefined) {
        const stored = readRecords(storage, watchesKey(owner), isRecord);
        const held = records.current;
        records.current = [...held, ...stored.filter((s) => !held.some((r) => r.key === s.key))];
        save();
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
    async (target, send) => {
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
          landed(target);
          return 'done';
        }
        if (!isUnknownOutcome(first.error)) {
          drop(key);
          throw first.error;
        }
        startWatch({ ...target, key, stage: 'readback', since: sentAt, notificationId: handOver() });
        return 'pending';
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
          drop(key);
          notify({ id: notificationId, variant: 'danger', ...failedText(target, describeError(result.error).message) });
        }
      });
      return 'pending';
    },
    [now, formWait, notify, startWatch, landed, keep, drop],
  );

  const value = useMemo(() => ({ submitWrite }), [submitWrite]);
  return <BackgroundWritesContext.Provider value={value}>{children}</BackgroundWritesContext.Provider>;
};
