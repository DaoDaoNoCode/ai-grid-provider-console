import type { ModelView } from '../pages/models/modelView';
import { NotificationResponseStatus } from './useNotificationWatcher';
import { READBACK_MS, READY_MS, readBack, watchReady, type ReadAnswer, type ReadObject } from './writeWatches';
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

  it('stops for a model that is gone, and keeps watching through a failed read', async () => {
    expect(await watchReady(model('create'), SINCE, reads(undefined), during)).toEqual({
      status: NotificationResponseStatus.STOP,
    });
    expect(await watchReady(model('create'), SINCE, reads(new Error('x')), during)).toEqual({
      status: NotificationResponseStatus.REPOLL,
    });
  });
});
