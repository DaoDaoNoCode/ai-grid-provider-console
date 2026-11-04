// Every word the notification center says about a Models or Subscriptions write, in one place for
// review. The backend commits these writes to a Git repository, and Argo CD applies them to the
// clusters later, so the words name each stage as it is: a write is "saved to Git" (or "deleted
// from Git"), a model is "ready" only once it runs on every cluster it is placed on (each cluster's
// status; users reach it through MaaS once a subscription covers it too).
// They follow frontend/AGENTS.md, "Wording": "Unable to <verb> <object>" for errors, no end
// punctuation in titles.
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
  /** For a model: the clusters the write deploys it to, or removes it from. */
  clusters?: string[];
};

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
    createAction: string;
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
    createAction: 'Deploy model',
  },
  subscription: {
    object: 'subscription',
    Object: 'Subscription',
    list: 'Subscriptions',
    listPath: getSectionUrl('subscriptions'),
    view: getSubscriptionViewUrl,
    edit: getSubscriptionEditUrl,
    createPath: getSubscriptionCreateUrl(),
    createAction: 'Create subscription',
  },
};

type Text = { title: string; message?: string; actions?: NotificationLink[] };

const viewAction = (t: WriteTarget): NotificationLink => {
  const s = subjects[t.subject];
  return { title: `View ${s.object}`, to: s.view(t.id) };
};

const listAction = (t: WriteTarget): NotificationLink => {
  const s = subjects[t.subject];
  return { title: `Go to ${s.list}`, to: s.listPath };
};

/** "a", "a and b", "a, b, and c" (the Oxford comma, frontend/AGENTS.md wording rule 18). */
export const listOf = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;

/** The model's clusters in words, or "its clusters" when the write doesn't name them. */
const clustersOf = (t: WriteTarget) => (t.clusters?.length ? listOf(t.clusters) : 'its clusters');

/** What the write does, as a title: "model Granite", "changes to model Granite". */
const thing = (t: WriteTarget) =>
  t.op === 'update' ? `changes to ${subjects[t.subject].object} ${t.name}` : `${subjects[t.subject].object} ${t.name}`;

/** How long a write that outlasts the form is checked for, in the words below. */
export const READBACK_MINUTES = 2;

/** How long a deployed model is watched until it is ready, in the words below. */
export const READY_MINUTES = 30;

/** The info entry while the write is out: the form left before the backend answered. */
export const pendingText = (t: WriteTarget): Text => {
  const s = subjects[t.subject];
  if (t.op === 'delete') {
    return { title: `Deleting ${s.object} ${t.name}`, message: "You'll be notified when it's deleted from Git." };
  }
  return t.op === 'create'
    ? { title: `Saving ${s.object} ${t.name}`, message: "You'll be notified when it's saved to Git." }
    : { title: `Saving changes to ${s.object} ${t.name}`, message: "You'll be notified when they're saved to Git." };
};

/**
 * The write is in Git: what happens next, which the backend doesn't do itself. Argo CD delivers a
 * model to its clusters, and a subscription to the ingress clusters.
 */
const nextStep = (t: WriteTarget): string => {
  if (t.subject === 'model') {
    if (t.op === 'create') return `It's being deployed to ${clustersOf(t)}. You'll be notified when it's ready.`;
    if (t.op === 'update') return `They're being rolled out to ${clustersOf(t)}.`;
    return `It's being removed from ${clustersOf(t)}.`;
  }
  if (t.op === 'create') return 'It takes effect once the ingress clusters apply it.';
  if (t.op === 'update') return 'They take effect once the ingress clusters apply them.';
  return "It's being removed from the ingress clusters.";
};

/** The write is confirmed: saved to Git (or deleted from it), on the fast path and the read-back alike. */
export const succeededText = (t: WriteTarget): Text => {
  const s = subjects[t.subject];
  const title =
    t.op === 'delete'
      ? `${s.Object} ${t.name} deleted from Git`
      : t.op === 'update'
        ? `Changes to ${s.object} ${t.name} saved to Git`
        : `${s.Object} ${t.name} saved to Git`;
  return { title, message: nextStep(t), ...(t.op === 'delete' ? {} : { actions: [viewAction(t)] }) };
};

/** The verb of an error title: "Unable to save model Granite", "Unable to delete model Granite". */
const unable = (t: WriteTarget) => `Unable to ${t.op === 'delete' ? 'delete' : 'save'} ${thing(t)}`;

/** The backend refused the write after the form had left: its message, and the way back to the form. */
export const failedText = (t: WriteTarget, message: string, draftId?: string): Text => {
  const s = subjects[t.subject];
  if (t.op === 'create') {
    // The link reopens the form with what was submitted, when the tab kept it (draftId).
    const to = draftId ? `${s.createPath}?draft=${encodeURIComponent(draftId)}` : s.createPath;
    return { title: unable(t), message, actions: [{ title: s.createAction, to }] };
  }
  if (t.op === 'update') {
    // The edit page opens on the object as it is now: the refused changes are gone, so say so.
    return {
      title: unable(t),
      message: `${message} Your changes weren't saved. Edit the ${s.object} again to make them.`,
      actions: [{ title: `Edit ${s.object}`, to: s.edit(t.id) }],
    };
  }
  return { title: unable(t), message, actions: [viewAction(t)] };
};

/** The backend answered every check, but the write never showed in Git. */
export const notConfirmedText = (t: WriteTarget): Text => {
  const s = subjects[t.subject];
  const after = `${READBACK_MINUTES} minutes after`;
  const message =
    t.op === 'create'
      ? `The ${s.object} wasn't found in Git ${after} it was submitted, and the reason is unknown. If it isn't in the ${s.list} list, ${t.subject === 'model' ? 'deploy' : 'create'} it again.`
      : t.op === 'update'
        ? `The changes weren't found in Git ${after} they were submitted, and the reason is unknown. Open the ${s.object} to check them, and edit it again if needed.`
        : `The ${s.object} is still in Git ${after} it was deleted, and the reason is unknown. If it's still in the ${s.list} list, delete it again.`;
  return { title: unable(t), message, actions: [t.op === 'create' ? listAction(t) : viewAction(t)] };
};

/** The checks themselves failed until the end: nobody can say whether the write landed. */
export const unconfirmedText = (t: WriteTarget): Text => {
  const s = subjects[t.subject];
  const what =
    t.op === 'delete'
      ? `the ${s.object} was deleted from Git`
      : t.op === 'update'
        ? 'the changes were saved to Git'
        : `the ${s.object} was saved to Git`;
  return {
    title: `Unable to confirm ${s.object} ${t.name}`,
    message: `The AI Grid backend didn't answer for ${READBACK_MINUTES} minutes, so it's unknown whether ${what}. Check the ${s.list} list.`,
    actions: [listAction(t)],
  };
};

/**
 * The object read back doesn't hold what this write sent: a create whose id holds another object,
 * an update whose version moved on with other content. Someone else's write may have won, so the
 * outcome is unknown: a warning, with the object to check.
 */
export const mismatchText = (t: WriteTarget): Text => {
  const s = subjects[t.subject];
  const message =
    t.op === 'create'
      ? `A ${s.object} with this name is in Git, but it doesn't match what you submitted. Someone else may have created it. Open the ${s.object} to check it.`
      : `The ${s.object} was changed in Git, but not as you submitted. Someone else may have edited it. Open the ${s.object} to check your changes.`;
  return { title: `Unable to confirm ${s.object} ${t.name}`, message, actions: [viewAction(t)] };
};

/** An update whose object was deleted meanwhile. */
export const goneText = (t: WriteTarget): Text => ({
  title: unable(t),
  message: `The ${subjects[t.subject].object} no longer exists.`,
  actions: [listAction(t)],
});

/** A deployed model became ready, on these clusters (none for a model on the hub alone). */
export const modelReadyText = (id: string, name: string, clusters: string[]): Text => ({
  title: clusters.length ? `Model ${name} is ready on ${listOf(clusters)}` : `Model ${name} is ready`,
  actions: [{ title: 'View model', to: modelPath({ id }) }],
});

/**
 * A deployed model isn't running on every cluster it is placed on after READY_MINUTES: the clusters
 * it isn't ready on, from each cluster's status, and the model to check. A warning: it may still
 * come up.
 */
export const modelNotReadyText = (id: string, name: string, clusters: string[]): Text => ({
  title: `Model ${name} isn't ready yet`,
  message: clusters.length
    ? `It isn't ready on ${listOf(clusters)} ${READY_MINUTES} minutes after it was saved to Git. Open the model to check each cluster's status.`
    : `It isn't ready ${READY_MINUTES} minutes after it was saved to Git. Open the model to check its status.`,
  actions: [{ title: 'View model', to: modelPath({ id }) }],
});

/** A deployed model failed: why, in the words the model's page uses. */
export const modelFailedText = (id: string, name: string, why: string | undefined): Text => ({
  title: `Unable to deploy model ${name}`,
  message: why ?? 'The model failed to deploy. Open it for details.',
  actions: [{ title: 'View model', to: modelPath({ id }) }],
});
