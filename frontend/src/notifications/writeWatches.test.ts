import type { ModelView } from '../pages/models/modelView';
import { NotificationResponseStatus } from './useNotificationWatcher';
import {
  NO_HISTORY,
  NO_STATUS_READS,
  READBACK_MS,
  READY_MS,
  nextHistory,
  readBack,
  statusOf,
  watchActive,
  watchChanges,
  watchReady,
  watchSubscriptionChanges,
  type ReadAnswer,
  type ReadObject,
} from './writeWatches';
import type { WriteTarget } from './writeText';

const SENT = 1_000_000;
const before = () => SENT + READBACK_MS - 1;
const after = () => SENT + READBACK_MS;

const reads =
  (answer: ReadAnswer | undefined | Error): ReadObject =>
  async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };

const model = (op: WriteTarget['op'], version?: number): WriteTarget => ({
  subject: 'model',
  op,
  id: 'widget',
  name: 'Widget',
  ...(version === undefined ? {} : { version }),
});

const subscription = (op: WriteTarget['op'], version?: number): WriteTarget => ({
  subject: 'subscription',
  op,
  id: 'team-a',
  name: 'Team A',
  ...(version === undefined ? {} : { version }),
});

describe('readBack', () => {
  it.each<[string, WriteTarget, ReadAnswer | undefined, string]>([
    ['a create is confirmed by the object', model('create'), { version: 1 }, 'Model Widget saved to Git'],
    [
      'an update by a version past the one sent',
      model('update', 3),
      { version: 4 },
      'Changes to model Widget saved to Git',
    ],
    ['a delete by NotFound', model('delete'), undefined, 'Model Widget deleted from Git'],
    ['a subscription create', subscription('create'), { version: 1 }, 'Subscription Team A saved to Git'],
    ['a subscription update', subscription('update', 1), { version: 2 }, 'Changes to subscription Team A saved to Git'],
    ['a subscription delete', subscription('delete'), undefined, 'Subscription Team A deleted from Git'],
  ])('confirms: %s', async (_name, target, answer, title) => {
    const response = await readBack(target, SENT, reads(answer), before);
    expect(response).toMatchObject({ status: NotificationResponseStatus.SUCCESS, title });
  });

  it.each<[string, WriteTarget, ReadAnswer | undefined]>([
    ['a create while the object is missing', model('create'), undefined],
    ['an update while the version is the one sent', model('update', 3), { version: 3 }],
    ['a delete while the object is still there', model('delete'), { version: 1 }],
  ])('checks again before the deadline: %s', async (_name, target, answer) => {
    expect(await readBack(target, SENT, reads(answer), before)).toEqual({ status: NotificationResponseStatus.REPOLL });
  });

  it.each<[string, WriteTarget, ReadAnswer | undefined, string, RegExp]>([
    [
      'a create never found',
      model('create'),
      undefined,
      'Unable to save model Widget',
      /wasn't found in Git 2 minutes after it was submitted, and the reason is unknown/,
    ],
    [
      'an update never seen',
      model('update', 3),
      { version: 3 },
      'Unable to save changes to model Widget',
      /changes weren't found in Git 2 minutes after/,
    ],
    [
      'a delete that left the object',
      subscription('delete'),
      { version: 1 },
      'Unable to delete subscription Team A',
      /is still in Git 2 minutes after it was deleted/,
    ],
  ])('says it was not done after the deadline: %s', async (_name, target, answer, title, message) => {
    const response = await readBack(target, SENT, reads(answer), after);
    expect(response).toMatchObject({ status: NotificationResponseStatus.ERROR, title });
    expect(response).toHaveProperty('message', expect.stringMatching(message));
  });

  describe('confirms only what this write sent', () => {
    const sent = { displayName: 'Widget', uri: 'hf://org/widget', replicas: '1' };
    const withFields = (target: WriteTarget): WriteTarget => ({ ...target, expected: sent });

    it('confirms a create, or an update past its version, whose fields read back as sent', async () => {
      const answer = { version: 4, fields: { ...sent, image: 'quay.io/x' } };
      expect(await readBack(withFields(model('create')), SENT, reads(answer), before)).toMatchObject({
        status: NotificationResponseStatus.SUCCESS,
        title: 'Model Widget saved to Git',
      });
      expect(await readBack(withFields(model('update', 3)), SENT, reads(answer), before)).toMatchObject({
        status: NotificationResponseStatus.SUCCESS,
        title: 'Changes to model Widget saved to Git',
      });
    });

    it("doesn't confirm a create whose id holds something else: a warning, not an error", async () => {
      const answer = { version: 1, fields: { ...sent, uri: 'hf://someone-else/widget' } };
      expect(await readBack(withFields(model('create')), SENT, reads(answer), before)).toEqual({
        status: NotificationResponseStatus.WARNING,
        title: 'Unable to confirm model Widget',
        message:
          "A model with this name is in Git, but it doesn't match what you submitted. Someone else may have created it. Open the model to check it.",
        actions: [{ title: 'View model', to: '/models/widget' }],
      });
    });

    it("doesn't confirm an update whose version moved on with other content", async () => {
      const answer = { version: 4, fields: { ...sent, replicas: '5' } };
      expect(await readBack(withFields(model('update', 3)), SENT, reads(answer), before)).toEqual({
        status: NotificationResponseStatus.WARNING,
        title: 'Unable to confirm model Widget',
        message:
          'The model was changed in Git, but not as you submitted. Someone else may have edited it. Open the model to check your changes.',
        actions: [{ title: 'View model', to: '/models/widget' }],
      });
    });
  });

  it('says an update failed when its object is gone', async () => {
    expect(await readBack(model('update', 3), SENT, reads(undefined), before)).toMatchObject({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to save changes to model Widget',
      message: 'The model no longer exists.',
    });
  });

  it('retries a failed read, then says the outcome is unknown, not that the write failed', async () => {
    const failing = reads(new Error('unavailable'));
    expect(await readBack(model('create'), SENT, failing, before)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    // A warning, not an error: nobody knows whether the write landed.
    expect(await readBack(model('create'), SENT, failing, after)).toMatchObject({
      status: NotificationResponseStatus.WARNING,
      title: 'Unable to confirm model Widget',
      actions: [{ title: 'Go to Models', to: '/models' }],
    });
  });
});

describe('watchReady', () => {
  const SINCE = 5_000_000;
  const view = (phase: ModelView['phase'], extra: Partial<ModelView> = {}): ReadAnswer => ({
    version: 2,
    model: {
      phase,
      clusters: [
        { cluster: 'site-b', phase: 'Ready', reason: 'Ready' },
        { cluster: 'site-c', phase: phase === 'Ready' ? 'Ready' : 'Pending', reason: 'Ready' },
      ],
      selectedClusters: ['site-b', 'site-c'],
      ...extra,
    } as ModelView,
  });
  const during = () => SINCE + READY_MS - 1;
  const past = () => SINCE + READY_MS;

  it('says a model is ready when every cluster it is placed on runs it', async () => {
    expect(await watchReady(model('create'), SINCE, reads(view('Ready')), during)).toEqual({
      status: NotificationResponseStatus.SUCCESS,
      title: 'Model Widget is ready on site-b and site-c',
      actions: [{ title: 'View model', to: '/models/widget' }],
    });
  });

  it('names no cluster for a model on the hub alone', async () => {
    const hub = view('Ready', { clusters: [], selectedClusters: [] });
    expect(await watchReady(model('create'), SINCE, reads(hub), during)).toMatchObject({
      title: 'Model Widget is ready',
    });
  });

  it("says a failed model failed, in its page's words for a known reason, else the backend's message", async () => {
    expect(
      await watchReady(model('update'), SINCE, reads(view('Failed', { reason: 'ConfigNotFound' })), during),
    ).toMatchObject({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to deploy model Widget',
      message: 'A runtime template this model needs isn’t installed on the hub.',
    });
    expect(
      await watchReady(model('create'), SINCE, reads(view('Failed', { statusMessage: 'image pull failed' })), during),
    ).toMatchObject({ message: 'image pull failed' });
  });

  it.each<ModelView['phase']>(['Pending', 'Partially available', 'Saved to Git', 'Unknown'])(
    'keeps watching a model that is %s while site-c runs no copy, and warns after 30 minutes',
    async (phase) => {
      expect(await watchReady(model('create'), SINCE, reads(view(phase)), during)).toEqual({
        status: NotificationResponseStatus.REPOLL,
      });
      expect(await watchReady(model('create'), SINCE, reads(view(phase)), past)).toEqual({
        status: NotificationResponseStatus.WARNING,
        title: "Model Widget isn't ready yet",
        message:
          "It isn't ready on site-c 30 minutes after it was saved to Git. Open the model to check each cluster's status.",
        actions: [{ title: 'View model', to: '/models/widget' }],
      });
    },
  );

  it('is ready when its placed clusters are, whatever an ingress cluster keeps the overall phase at', async () => {
    // demo1: the model runs on site-b, but site-a, an ingress cluster, reports its MaaSModelRef
    // not Ready until a subscription covers it, so the whole model reads Pending.
    const ingressPending = view('Pending', {
      statusMessage: 'Not ready on site-a; ready on site-b',
      selectedClusters: ['site-b'],
      clusters: [{ cluster: 'site-b', phase: 'Ready', reason: 'Ready' }],
    });
    expect(await watchReady(model('create'), SINCE, reads(ingressPending), during)).toEqual({
      status: NotificationResponseStatus.SUCCESS,
      title: 'Model Widget is ready on site-b',
      actions: [{ title: 'View model', to: '/models/widget' }],
    });
  });

  it('waits for a placed cluster that has no report yet', async () => {
    const unreported = view('Pending', {
      selectedClusters: ['site-b', 'site-c'],
      clusters: [{ cluster: 'site-b', phase: 'Ready', reason: 'Ready' }],
    });
    expect(await watchReady(model('create'), SINCE, reads(unreported), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });

  it('says a cluster that failed failed', async () => {
    const failing = view('Pending', {
      clusters: [
        { cluster: 'site-b', phase: 'Ready', reason: 'Ready' },
        { cluster: 'site-c', phase: 'Failed', reason: 'NotReady', message: 'LLMInferenceService failed' },
      ],
    });
    expect(await watchReady(model('create'), SINCE, reads(failing), during)).toMatchObject({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to deploy model Widget',
      message: 'site-c: LLMInferenceService failed',
    });
  });

  it("doesn't call a model not ready when its last read failed: it says it can't confirm", async () => {
    expect(await watchReady(model('create'), SINCE, reads(new Error('unavailable')), past)).toEqual({
      status: NotificationResponseStatus.WARNING,
      title: 'Unable to confirm model Widget is ready',
      message:
        "The console couldn't read its status 30 minutes after it was saved to Git. Open the model to check its status.",
      actions: [{ title: 'View model', to: '/models/widget' }],
    });
  });

  it('stops for a model that is gone, and keeps watching through a failed read', async () => {
    expect(await watchReady(model('create'), SINCE, reads(undefined), during)).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(await watchReady(model('create'), SINCE, reads(new Error('x')), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });
});

describe('watchChanges', () => {
  const SINCE = 5_000_000;
  const view = (
    phase: ModelView['phase'],
    siteB: ModelView['phase'] = 'Ready',
    extra: Partial<ModelView> = {},
  ): ReadAnswer => ({
    version: 3,
    model: {
      phase,
      clusters: [{ cluster: 'site-b', phase: siteB, reason: siteB === 'Ready' ? 'Ready' : 'NotReady' }],
      selectedClusters: ['site-b'],
      ...extra,
    } as ModelView,
  });
  const during = () => SINCE + READY_MS - 1;
  const past = () => SINCE + READY_MS;
  const ready = view('Ready');

  it('never says ready: it keeps following a ready model, and ends silently after 30 minutes', async () => {
    expect(await watchChanges(model('update'), SINCE, reads(ready), during, undefined)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchChanges(model('update'), SINCE, reads(ready), during, statusOf(ready))).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchChanges(model('update'), SINCE, reads(ready), past, statusOf(ready))).toEqual({
      status: NotificationResponseStatus.STOP,
    });
  });

  it('says the changes failed when it sees the model turn failed, in the words of its page', async () => {
    const failed = view('Failed', 'Ready', { reason: 'ConfigNotFound' });
    expect(await watchChanges(model('update'), SINCE, reads(failed), during, statusOf(ready))).toEqual({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to roll out changes to model Widget',
      message: 'A runtime template this model needs isn’t installed on the hub.',
      actions: [{ title: 'View model', to: '/models/widget' }],
    });
  });

  it('says the changes failed when a placed cluster turns failed', async () => {
    const failing = view('Pending', 'Failed', {
      clusters: [{ cluster: 'site-b', phase: 'Failed', reason: 'NotReady', message: 'LLMInferenceService failed' }],
    });
    expect(await watchChanges(model('update'), SINCE, reads(failing), during, statusOf(ready))).toMatchObject({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to roll out changes to model Widget',
      message: 'site-b: LLMInferenceService failed',
    });
  });

  it("doesn't blame the edit for a failure it found when it started, until that failure changes", async () => {
    const failedBefore = view('Failed', 'Failed', { statusMessage: 'image pull failed' });
    // The first read, as the edit lands: the previous revision's failure.
    expect(await watchChanges(model('update'), SINCE, reads(failedBefore), during, undefined)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchChanges(model('update'), SINCE, reads(failedBefore), during, statusOf(failedBefore))).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    // A new failure, with another reason, is the edit's.
    const failedAgain = view('Failed', 'Ready', { reason: 'ConfigNotFound' });
    expect(
      await watchChanges(model('update'), SINCE, reads(failedAgain), during, statusOf(failedBefore)),
    ).toMatchObject({
      status: NotificationResponseStatus.ERROR,
      title: 'Unable to roll out changes to model Widget',
      message: 'A runtime template this model needs isn’t installed on the hub.',
    });
  });

  it('stops for a model that is gone, and keeps watching through a failed read', async () => {
    expect(await watchChanges(model('update'), SINCE, reads(undefined), during, statusOf(ready))).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(await watchChanges(model('update'), SINCE, reads(new Error('x')), during, statusOf(ready))).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });
});

describe('watchActive', () => {
  const SINCE = 5_000_000;
  const created = (organization?: string): WriteTarget => ({
    ...subscription('create'),
    ...(organization === undefined ? {} : { organization }),
  });
  const status = (phase: string, policy = phase): ReadAnswer => ({
    version: 1,
    subscription: { phase, policies: [{ id: 'team-a-policy', phase: policy }] },
  });
  const during = () => SINCE + READY_MS - 1;
  const past = () => SINCE + READY_MS;

  it('says a subscription is active once it and its authorization policy are, naming the organization', async () => {
    expect(await watchActive(created('Acme Robotics'), SINCE, reads(status('Active')), during)).toEqual({
      status: NotificationResponseStatus.SUCCESS,
      title: 'Subscription Team A is active',
      message: 'Users in its groups in the Acme Robotics organization can use its models.',
      actions: [{ title: 'View subscription', to: '/subscriptions/view/team-a' }],
    });
  });

  it("leaves the organization out when the form didn't know its name", async () => {
    expect(await watchActive(created(), SINCE, reads(status('Active')), during)).toMatchObject({
      status: NotificationResponseStatus.SUCCESS,
      message: 'Users in its groups can use its models.',
    });
  });

  it("isn't active while Get lists no authorization policy: it waits, then warns about the policy", async () => {
    // Without the policy its users can't call its models; the backend creates it with the
    // subscription, so none listed is a policy not there yet, not one the subscription can do without.
    const alone: ReadAnswer = { version: 1, subscription: { phase: 'Active', policies: [] } };
    expect(await watchActive(created(), SINCE, reads(alone), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchActive(created(), SINCE, reads(alone), past)).toEqual({
      status: NotificationResponseStatus.WARNING,
      title: "Subscription Team A isn't active yet",
      message:
        "Its authorization policy isn't active on every ingress cluster 30 minutes after it was saved to Git, so users in its groups might not be able to use its models. Open the subscription to check the policy's status.",
      actions: [{ title: 'View subscription', to: '/subscriptions/view/team-a' }],
    });
  });

  it('keeps watching a pending subscription, and warns after 30 minutes', async () => {
    expect(await watchActive(created('Acme Robotics'), SINCE, reads(status('Pending')), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchActive(created('Acme Robotics'), SINCE, reads(status('Pending')), past)).toEqual({
      status: NotificationResponseStatus.WARNING,
      title: "Subscription Team A isn't active yet",
      message:
        "It isn't active on every ingress cluster 30 minutes after it was saved to Git, so users in its groups in the Acme Robotics organization might not be able to use its models. Open the subscription to check its status and its models' status.",
      actions: [{ title: 'View subscription', to: '/subscriptions/view/team-a' }],
    });
  });

  it("waits for its authorization policy, without which users can't call its models", async () => {
    // MaaS needs both: the policy grants access to the models, the subscription the quota.
    const policyPending = status('Active', 'Pending');
    expect(await watchActive(created(), SINCE, reads(policyPending), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchActive(created(), SINCE, reads(policyPending), past)).toEqual({
      status: NotificationResponseStatus.WARNING,
      title: "Subscription Team A isn't active yet",
      message:
        "Its authorization policy isn't active on every ingress cluster 30 minutes after it was saved to Git, so users in its groups might not be able to use its models. Open the subscription to check the policy's status.",
      actions: [{ title: 'View subscription', to: '/subscriptions/view/team-a' }],
    });
  });

  describe('an empty phase', () => {
    const none = reads(status('', ''));

    it('claims nothing when no ingress cluster ever reports a status: it stops silently on the third empty read in a row', async () => {
      expect(await watchActive(created(), SINCE, none, () => SINCE, NO_HISTORY)).toEqual({
        status: NotificationResponseStatus.REPOLL,
      });
      expect(await watchActive(created(), SINCE, none, () => SINCE, { empties: 1 })).toEqual({
        status: NotificationResponseStatus.REPOLL,
      });
      expect(await watchActive(created(), SINCE, none, () => SINCE, { empties: NO_STATUS_READS - 1 })).toEqual({
        status: NotificationResponseStatus.STOP,
      });
    });

    it("doesn't stop on one empty read that comes late, as after a delayed first read", async () => {
      expect(await watchActive(created(), SINCE, none, () => SINCE + 5 * 60_000, NO_HISTORY)).toEqual({
        status: NotificationResponseStatus.REPOLL,
      });
    });

    it('takes empty reads after a status for a status unavailable for now, and goes on', async () => {
      expect(
        await watchActive(created(), SINCE, none, during, { empties: NO_STATUS_READS + 10, last: 'subscription' }),
      ).toEqual({ status: NotificationResponseStatus.REPOLL });
    });

    it('warns at the deadline from the last read that found a status, when the last one finds none', async () => {
      expect(await watchActive(created(), SINCE, none, past, { empties: 40, last: 'subscription' })).toMatchObject({
        status: NotificationResponseStatus.WARNING,
        title: "Subscription Team A isn't active yet",
        message: expect.stringMatching(/^It isn't active on every ingress cluster/),
      });
      // The policy-only variant: the last status had the subscription Active and its policy Pending.
      expect(await watchActive(created(), SINCE, none, past, { empties: 2, last: 'policy' })).toMatchObject({
        status: NotificationResponseStatus.WARNING,
        title: "Subscription Team A isn't active yet",
        message: expect.stringMatching(/^Its authorization policy isn't active/),
      });
    });

    it("says it can't confirm at the deadline when no read found a status", async () => {
      expect(await watchActive(created(), SINCE, none, past, { empties: 1 })).toMatchObject({
        status: NotificationResponseStatus.WARNING,
        title: 'Unable to confirm subscription Team A is active',
      });
    });

    it('is active on the read that finds it so, whatever came before', async () => {
      expect(
        await watchActive(created(), SINCE, reads(status('Active')), during, { empties: 2, last: 'subscription' }),
      ).toMatchObject({ status: NotificationResponseStatus.SUCCESS, title: 'Subscription Team A is active' });
    });
  });

  it("doesn't call a subscription inactive when its last read failed: it says it can't confirm", async () => {
    expect(await watchActive(created(), SINCE, reads(new Error('unavailable')), past)).toEqual({
      status: NotificationResponseStatus.WARNING,
      title: 'Unable to confirm subscription Team A is active',
      message:
        "The console couldn't read its status 30 minutes after it was saved to Git. Open the subscription to check its status.",
      actions: [{ title: 'View subscription', to: '/subscriptions/view/team-a' }],
    });
  });

  it('stops for a subscription that is gone, and keeps watching through a failed read', async () => {
    expect(await watchActive(created(), SINCE, reads(undefined), during)).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(await watchActive(created(), SINCE, reads(new Error('x')), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });
});

describe('watchSubscriptionChanges', () => {
  const SINCE = 5_000_000;
  const status = (phase: string): ReadAnswer => ({
    version: 2,
    subscription: { phase, policies: [{ id: 'team-a-policy', phase }] },
  });
  const during = () => SINCE + READY_MS - 1;
  const past = () => SINCE + READY_MS;

  it.each(['Active', 'Pending'])(
    'says nothing of a subscription that is %s, and ends after 30 minutes',
    async (phase) => {
      expect(await watchSubscriptionChanges(subscription('update'), SINCE, reads(status(phase)), during)).toEqual({
        status: NotificationResponseStatus.REPOLL,
      });
      expect(await watchSubscriptionChanges(subscription('update'), SINCE, reads(status(phase)), past)).toEqual({
        status: NotificationResponseStatus.STOP,
      });
    },
  );

  it('stops on the third empty read in a row when no read found a status, and not after one', async () => {
    const none = reads(status(''));
    const edited = subscription('update');
    expect(await watchSubscriptionChanges(edited, SINCE, none, () => SINCE + 5 * 60_000, NO_HISTORY)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
    expect(await watchSubscriptionChanges(edited, SINCE, none, during, { empties: NO_STATUS_READS - 1 })).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(
      await watchSubscriptionChanges(edited, SINCE, none, during, { empties: NO_STATUS_READS - 1, last: 'active' }),
    ).toEqual({ status: NotificationResponseStatus.REPOLL });
  });

  it('stops for a subscription that is gone, and keeps watching through a failed read', async () => {
    expect(await watchSubscriptionChanges(subscription('update'), SINCE, reads(undefined), during)).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(await watchSubscriptionChanges(subscription('update'), SINCE, reads(new Error('x')), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });
});

describe('nextHistory', () => {
  const status = (phase: string): ReadAnswer => ({
    version: 1,
    subscription: { phase, policies: [{ id: 'team-a-policy', phase }] },
  });

  it('counts empty reads in a row, and a failed read ends the run without forgetting the last verdict', () => {
    expect(nextHistory({ empties: 2 }, status(''))).toEqual({ empties: 3 });
    expect(nextHistory({ empties: 2 }, 'failed')).toEqual({ empties: 0 });
    expect(nextHistory({ empties: 2, last: 'policy' }, 'failed')).toEqual({ empties: 0, last: 'policy' });
    expect(nextHistory({ empties: 2 }, status('Pending'))).toEqual({ empties: 0, last: 'subscription' });
    expect(nextHistory({ empties: 2 }, undefined)).toEqual({ empties: 2 });
  });

  it('never stops a watch on empty reads with failed reads between them', async () => {
    // empty, failed, empty, failed, empty: no three empty reads in a row.
    let history = NO_HISTORY;
    for (const answer of [status(''), 'failed', status(''), 'failed'] as const) history = nextHistory(history, answer);
    const lastEmpty = await watchActive(subscription('create'), 0, reads(status('')), () => 0, history);
    expect(lastEmpty).toEqual({ status: NotificationResponseStatus.REPOLL });
  });
});

describe('statusOf', () => {
  it("tells a subscription's phase, and its authorization policy's, apart", () => {
    const of = (phase: string, policy: string) =>
      statusOf({ version: 1, subscription: { phase, policies: [{ id: 'team-a-policy', phase: policy }] } });
    expect(of('Pending', 'Pending')).not.toBe(of('Active', 'Pending'));
    expect(of('Active', 'Pending')).not.toBe(of('Active', 'Active'));
    expect(of('Active', 'Active')).toBe(of('Active', 'Active'));
    expect(statusOf(undefined)).toBe('gone');
  });
});
