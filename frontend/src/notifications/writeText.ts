// Every word the notification center says about a write that outlasts the form, in one place for
// review. They follow frontend/AGENTS.md, "Wording": "Unable to <verb> <object>" for errors,
// "<Object> <past participle>" for a success, no end punctuation in titles.
import { modelPath } from '../pages/models/modelUtils';
import {
  getSectionUrl,
  getSubscriptionCreateUrl,
  getSubscriptionEditUrl,
  getSubscriptionViewUrl,
} from '../utilities/maasGovernanceNavigation';
import type { NotificationLink } from './useNotifications';
import type { WriteFields } from './writeFields';

export type WriteSubject = 'model' | 'subscription';
export type WriteOp = 'create' | 'update' | 'delete';

/** A write the notification center follows: what it changes and the name the pages show. */
export type WriteTarget = {
  subject: WriteSubject;
  op: WriteOp;
  id: string;
  /** The display name, else the id. */
  name: string;
  /** For an update: the version the write was sent at, which a landed update moves on from. */
  version?: number;
  /** What the write sent (writeFields.ts), which a read-back must find to confirm it. */
  expected?: WriteFields;
};

type Verbs = { verb: string; past: string; gerund: string };

const subjects: Record<
  WriteSubject,
  {
    object: string;
    Object: string;
    list: string;
    listPath: string;
    view: (id: string) => string;
    edit: (id: string) => string;
    createPath: string;
    ops: Record<WriteOp, Verbs>;
  }
> = {
  model: {
    object: 'model',
    Object: 'Model',
    list: 'Models',
    listPath: '/models',
    view: (id) => modelPath({ id }),
    edit: (id) => `${modelPath({ id })}/edit`,
    createPath: '/models/deploy',
    ops: {
      create: { verb: 'deploy', past: 'deployed', gerund: 'Deploying' },
      update: { verb: 'update', past: 'updated', gerund: 'Updating' },
      delete: { verb: 'delete', past: 'deleted', gerund: 'Deleting' },
    },
  },
  subscription: {
    object: 'subscription',
    Object: 'Subscription',
    list: 'Subscriptions',
    listPath: getSectionUrl('subscriptions'),
    view: getSubscriptionViewUrl,
    edit: getSubscriptionEditUrl,
    createPath: getSubscriptionCreateUrl(),
    ops: {
      create: { verb: 'create', past: 'created', gerund: 'Creating' },
      update: { verb: 'update', past: 'updated', gerund: 'Updating' },
      delete: { verb: 'delete', past: 'deleted', gerund: 'Deleting' },
    },
  },
};

type Text = { title: string; message?: string; actions?: NotificationLink[] };

const words = (t: WriteTarget) => ({ ...subjects[t.subject], ...subjects[t.subject].ops[t.op] });

const viewAction = (t: WriteTarget): NotificationLink => {
  const s = subjects[t.subject];
  return { title: `View ${s.object}`, to: s.view(t.id) };
};

const listAction = (t: WriteTarget): NotificationLink => {
  const s = subjects[t.subject];
  return { title: `Go to ${s.list}`, to: s.listPath };
};

/** How long a write that outlasts the form is checked for, in the words below. */
export const READBACK_MINUTES = 2;

/** The info toast when the form leaves before the backend has answered. */
export const pendingText = (t: WriteTarget): Text => {
  const w = words(t);
  return { title: `${w.gerund} ${w.object} ${t.name}`, message: "You'll be notified when it's done." };
};

/**
 * The success notice of a write the backend answered within the form's wait, in the words the
 * notification center uses for one it confirmed later: "Model <name> deployed".
 */
export const doneNotice = (subject: WriteSubject, op: WriteOp, name: string) =>
  succeededText({ subject, op, id: '', name }).title;

/** The write landed. */
export const succeededText = (t: WriteTarget): Text => {
  const w = words(t);
  return {
    title: `${w.Object} ${t.name} ${w.past}`,
    ...(t.op === 'delete' ? {} : { actions: [viewAction(t)] }),
  };
};

/** The backend refused the write after the form had left: its message, and the way back to the form. */
export const failedText = (t: WriteTarget, message: string): Text => {
  const w = words(t);
  const s = subjects[t.subject];
  const action =
    t.op === 'create'
      ? { title: `${w.verb === 'deploy' ? 'Deploy' : 'Create'} ${w.object}`, to: s.createPath }
      : t.op === 'update'
        ? { title: `Edit ${w.object}`, to: s.edit(t.id) }
        : viewAction(t);
  return { title: `Unable to ${w.verb} ${w.object} ${t.name}`, message, actions: [action] };
};

/** The backend answered every check, but the write never showed. */
export const notConfirmedText = (t: WriteTarget): Text => {
  const w = words(t);
  const after = `${READBACK_MINUTES} minutes after`;
  const message =
    t.op === 'create'
      ? `The ${w.object} wasn't found ${after} it was submitted, and the reason is unknown. If it isn't in the ${w.list} list, ${w.verb} it again.`
      : t.op === 'update'
        ? `The changes weren't found ${after} they were submitted, and the reason is unknown. Open the ${w.object} to check them, and edit it again if needed.`
        : `The ${w.object} still exists ${after} it was deleted, and the reason is unknown. If it's still in the ${w.list} list, delete it again.`;
  return {
    title: `Unable to ${w.verb} ${w.object} ${t.name}`,
    message,
    actions: [t.op === 'create' ? listAction(t) : viewAction(t)],
  };
};

/** The checks themselves failed until the end: nobody can say whether the write landed. */
export const unconfirmedText = (t: WriteTarget): Text => {
  const w = words(t);
  return {
    title: `Unable to confirm ${w.object} ${t.name}`,
    message: `The AI Grid backend didn't answer for ${READBACK_MINUTES} minutes, so it's unknown whether the ${w.object} was ${w.past}. Check the ${w.list} list.`,
    actions: [listAction(t)],
  };
};

/**
 * The object read back doesn't hold what this write sent: a create whose id holds another object,
 * an update whose version moved on with other content. Someone else's write may have won, so the
 * outcome is unknown: a warning, with the object to check.
 */
export const mismatchText = (t: WriteTarget): Text => {
  const w = words(t);
  const message =
    t.op === 'create'
      ? `A ${w.object} with this name exists, but it doesn't match what you submitted. Someone else may have ${w.past} it. Open the ${w.object} to check it.`
      : `The ${w.object} was changed, but not as you submitted. Someone else may have edited it. Open the ${w.object} to check your changes.`;
  return { title: `Unable to confirm ${w.object} ${t.name}`, message, actions: [viewAction(t)] };
};

/** An update whose object was deleted meanwhile. */
export const goneText = (t: WriteTarget): Text => {
  const w = words(t);
  return {
    title: `Unable to ${w.verb} ${w.object} ${t.name}`,
    message: `The ${w.object} no longer exists.`,
    actions: [listAction(t)],
  };
};

/** "a", "a and b", "a, b, and c" (the Oxford comma, frontend/AGENTS.md wording rule 18). */
export const listOf = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;

/** A deployed or edited model became ready, on these clusters (none for a model on the hub alone). */
export const modelReadyText = (id: string, name: string, clusters: string[]): Text => ({
  title: clusters.length ? `Model ${name} is ready on ${listOf(clusters)}` : `Model ${name} is ready`,
  actions: [{ title: 'View model', to: modelPath({ id }) }],
});

/** A deployed or edited model failed: why, in the words the model's page uses. */
export const modelFailedText = (id: string, name: string, why: string | undefined): Text => ({
  title: `Unable to deploy model ${name}`,
  message: why ?? 'The model failed to deploy. Open it for details.',
  actions: [{ title: 'View model', to: modelPath({ id }) }],
});
