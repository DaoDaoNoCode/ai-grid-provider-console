import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ServiceError } from '../api/ConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';
import { INSTALLED_PRESETS, GATE_DISABLED_MESSAGE, placedPhase, rolloutFromWorks, seedModels, selectClusters } from '../api/mockModels';
import type { Model, PlacementSpec } from '../api/types';
import { ModelsPage, STARTING_REASONS, canDeploy, locationsOf, phasePresentation, sitesSummary, toCreateBody } from '../pages/ModelsPage';
import type { FormValues } from '../pages/ModelsPage';

const findModel = (name: string) => screen.findByTestId(`model-${name}`);
const queryModel = (name: string) => screen.queryByTestId(`model-${name}`);
const admin = (service = new MockConsoleService()) => <ModelsPage service={service} canEdit />;
/** Types into a form field by its id (several labels in the deploy form contain the word "Name"). */
const typeInto = (id: string, value: string) => fireEvent.change(document.getElementById(id) as HTMLElement, { target: { value } });
const runAction = async (name: string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  const menuItem = await screen.findByRole('menuitem', { name: item });
  await act(async () => {
    fireEvent.click(menuItem);
  });
};

describe('ModelsPage', () => {
  it('lists the models with their phase, replicas, sites and URL', async () => {
    render(admin());
    await findModel('tiny-llm');
    expect(screen.getByTestId('model-tiny-llm')).toHaveTextContent('Tiny LLM (CPU)');
    expect(screen.getByTestId('phase-tiny-llm')).toHaveTextContent('Ready');
    expect(screen.getByTestId('sites-tiny-llm')).toHaveTextContent('Hub');
    expect(screen.getByRole('link', { name: 'https://openshift-ai-inference.apps.hub.example.com/ai-grid-models/tiny-llm' })).toBeInTheDocument();
    expect(screen.getByTestId('phase-granite-8b-instruct')).toHaveTextContent('Ready');
    expect(screen.getByTestId('sites-granite-8b-instruct')).toHaveTextContent('1 / 1 site');
    expect(screen.getByTestId('phase-mistral-7b-instruct')).toHaveTextContent('Pending');
    expect(screen.getByTestId('phase-mistral-7b-instruct')).toHaveTextContent('Processing');
    expect(screen.getByTestId('sites-mistral-7b-instruct')).toHaveTextContent('0 / 2 sites');
    expect(screen.getByTestId('phase-llama-3-70b')).toHaveTextContent('Failed');
    expect(screen.getByTestId('phase-llama-3-70b')).toHaveTextContent('ConfigNotFound');
    expect(screen.getByTestId('phase-codellama-13b')).toHaveTextContent('Pending');
    expect(screen.getByTestId('phase-codellama-13b')).toHaveTextContent('PlacementDecisionEmpty');
    expect(screen.queryByText('Multi-site placement is not available on this hub')).not.toBeInTheDocument();
  });

  it('expands a model to show its conditions, or its placement and per-site works', async () => {
    render(admin());
    await findModel('llama-3-70b');
    // Rows are in namespace/name order: codellama, granite, llama, mistral, tiny.
    fireEvent.click(screen.getAllByLabelText('Details')[2]);
    const conditions = await screen.findByLabelText('Conditions of llama-3-70b');
    expect(within(conditions).getAllByText('ConfigNotFound')).toHaveLength(2);
    expect(within(conditions).getAllByText(/not found in namespaces \[ai-grid-models redhat-ods-applications\]/)).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText('Details')[1]);
    const work = await screen.findByTestId('work-granite-8b-instruct-site-paris-1');
    expect(within(work).getByText('model-granite-8b-instruct-x7k2p')).toBeInTheDocument();
    expect(within(work).getAllByText('True')).toHaveLength(3); // Applied, Available and the ready feedback
    expect(within(work).getAllByText('False')).toHaveLength(2); // Progressing, Degraded
    expect(within(work).getByRole('link', { name: /apps\.site-paris-1\.example\.com\/ai-grid-models\/granite-8b-instruct/ })).toBeInTheDocument();
    expect(screen.getByText('AllDecisionsScheduled')).toBeInTheDocument();
    expect(screen.getByText(/All, deadline 15m \/ 1 of 1 available, 0 progressing, 0 degraded \(AsExpected\)/)).toBeInTheDocument();
  });

  it('hides the actions from a viewer', async () => {
    render(<ModelsPage service={new MockConsoleService()} canEdit={false} />);
    await findModel('tiny-llm');
    expect(screen.queryByRole('button', { name: 'Deploy model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for tiny-llm' })).not.toBeInTheDocument();
  });

  it('deploys a multi-site model from the modal with the POC inputs mapped to the spec', async () => {
    const service = new MockConsoleService();
    const spy = vi.spyOn(service, 'createModel');
    render(admin(service));
    await findModel('tiny-llm');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy model' }));
    const dialog = await screen.findByRole('dialog');
    typeInto('model-name', 'phi-4-mini');
    typeInto('model-display-name', 'Phi 4 mini');
    typeInto('model-uri', 'hf://example-org/phi-4-mini');
    typeInto('model-model-name', 'example-org/phi-4-mini');
    typeInto('model-image', 'quay.io/example/vllm-cuda:v0.11.0');
    typeInto('model-cpu', '8');
    typeInto('model-memory', '32Gi');
    typeInto('model-gpu', '1');
    fireEvent.click(within(dialog).getByLabelText('Sites by location'));
    fireEvent.click(await within(dialog).findByLabelText('paris'));
    fireEvent.change(within(dialog).getByLabelText('Rollout'), { target: { value: 'Progressive' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith({
      name: 'phi-4-mini',
      namespace: 'ai-grid-models',
      modelUri: 'hf://example-org/phi-4-mini',
      displayName: 'Phi 4 mini',
      modelName: 'example-org/phi-4-mini',
      runtimeImage: 'quay.io/example/vllm-cuda:v0.11.0',
      baseRefs: ['v3-6-0-kserve-config-llm-template'],
      replicas: 1,
      cpu: '8',
      memory: '32Gi',
      gpuCount: 1,
      placement: {
        clusterSets: ['global'],
        matchLabels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true' },
        matchExpressions: [{ key: 'location', operator: 'In', values: ['paris'] }],
      },
      rollout: { strategy: 'Progressive', maxConcurrency: '1', progressDeadline: '15m' },
    });
    await findModel('phi-4-mini');
    expect(screen.getByTestId('phase-phi-4-mini')).toHaveTextContent('Pending');
    expect(screen.getByTestId('sites-phi-4-mini')).toHaveTextContent('0 / 1 site');
    const created = service.models.find((m) => m.name === 'phi-4-mini')!;
    expect(created.placement?.selectedClusters).toEqual(['site-paris-1']);
    expect(created.requests).toEqual({ cpu: '8', memory: '32Gi', 'nvidia.com/gpu': '1' });
  });

  it('shows the backend message in the modal for a duplicate or an invalid name', async () => {
    render(admin());
    await findModel('tiny-llm');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy model' }));
    const dialog = await screen.findByRole('dialog');
    typeInto('model-name', 'tiny-llm');
    typeInto('model-uri', 'hf://example-org/tiny-llm');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    });
    expect(await within(dialog).findByText('llminferenceservices.serving.kserve.io "tiny-llm" already exists')).toBeInTheDocument();
    typeInto('model-name', 'Tiny');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    });
    expect(await within(dialog).findByText(/a lowercase RFC 1123 subdomain must consist of/)).toBeInTheDocument();
    typeInto('model-name', 'fine');
    typeInto('model-uri', 'https://example.com/model');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    });
    expect(await within(dialog).findByText(/unsupported scheme; expected one of hf:\/\/, s3:\/\/, pvc:\/\/, oci:\/\//)).toBeInTheDocument();
  });

  it('explains a disabled ManifestWorkReplicaSet gate and keeps placement off', async () => {
    const service = new MockConsoleService();
    service.capabilities = { manifestWorkReplicaSetEnabled: false, observabilityInstalled: false, acmVersion: '2.17.3' };
    render(admin(service));
    await findModel('tiny-llm');
    expect(await screen.findByText('Multi-site placement is not available on this hub')).toBeInTheDocument();
    expect(screen.getByText(/ACM 2\.17\.3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy model' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Sites by location')).toBeDisabled();
    // The backend is the authority: a placement sent anyway is refused with 412.
    await expect(service.createModel({ name: 'x', namespace: 'ns', modelUri: 'hf://x/y', placement: {} })).rejects.toMatchObject({ status: 412, message: GATE_DISABLED_MESSAGE });
  });

  it('keeps the deploy button off while site discovery is pending or failed, and needs an explicit all-sites choice', async () => {
    const service = new MockConsoleService();
    service.listClusters = async () => {
      throw new ServiceError(503, 'the AI Grid backend is unavailable; try again');
    };
    render(admin(service));
    await findModel('tiny-llm');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy model' }));
    const dialog = await screen.findByRole('dialog');
    typeInto('model-name', 'phi-4-mini');
    typeInto('model-uri', 'hf://example-org/phi-4-mini');
    expect(within(dialog).getByRole('button', { name: 'Deploy' })).toBeEnabled(); // hub only needs no discovery
    fireEvent.click(within(dialog).getByLabelText('Sites by location'));
    expect(await within(dialog).findByTestId('discovery-error')).toHaveTextContent('the AI Grid backend is unavailable; try again');
    expect(within(dialog).getByRole('button', { name: 'Deploy' })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('All eligible sites'));
    expect(within(dialog).getByRole('button', { name: 'Deploy' })).toBeDisabled(); // discovery failed: still off

    // Discovery recovers on retry; without a location or the explicit choice the button stays off.
    const spy = vi.spyOn(service, 'createModel');
    service.listClusters = async () => new MockConsoleService().clusters;
    fireEvent.click(within(dialog).getByLabelText('Selected locations'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await within(dialog).findByLabelText('paris');
    expect(within(dialog).getByRole('button', { name: 'Deploy' })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('All eligible sites'));
    expect(within(dialog).getByRole('button', { name: 'Deploy' })).toBeEnabled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(spy.mock.calls[0][0].placement).toEqual({ clusterSets: ['global'], matchLabels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true' } });
  });

  it('says nothing about the gate when the backend has no capabilities RPC', async () => {
    const service = new MockConsoleService();
    service.getCapabilities = async () => {
      throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
    };
    render(admin(service));
    await findModel('tiny-llm');
    expect(screen.queryByText('Multi-site placement is not available on this hub')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy model' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('Sites by location')).toBeEnabled();
  });

  it('edits the replicas and deletes a model for an admin', async () => {
    const service = new MockConsoleService();
    const update = vi.spyOn(service, 'updateModel');
    const remove = vi.spyOn(service, 'deleteModel');
    render(admin(service));
    await findModel('tiny-llm');
    await runAction('tiny-llm', 'Edit replicas');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Replicas', { exact: false }), { target: { value: '3' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(update).toHaveBeenCalledWith('ai-grid-models', 'tiny-llm', { replicas: 3 });
    await waitFor(() => expect(screen.getByTestId('model-tiny-llm').closest('tr')).toHaveTextContent('3'));

    await runAction('llama-3-70b', 'Delete');
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('The LLMInferenceService is removed from the hub.');
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(queryModel('llama-3-70b')).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledWith('ai-grid-models', 'llama-3-70b');
  });

  it('shows a referenced model as not deletable with the backend message', async () => {
    const service = new MockConsoleService();
    service.deleteModel = async () => {
      throw new ServiceError(412, 'model ai-grid-models/tiny-llm is referenced by subscription acme/gold; remove those references first');
    };
    render(admin(service));
    await findModel('tiny-llm');
    await runAction('tiny-llm', 'Delete');
    const confirm = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    });
    expect(await screen.findByText('Model tiny-llm could not be deleted')).toBeInTheDocument();
    expect(screen.getByText(/referenced by subscription acme\/gold/)).toBeInTheDocument();
  });

  it('shows the not-available state when the backend lacks the RPC', async () => {
    const service = new MockConsoleService();
    service.listModels = async () => {
      throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
    };
    render(admin(service));
    expect(await screen.findByText('Models are not available on this backend yet')).toBeInTheDocument();
  });
});

describe('phase presentation', () => {
  it('shows a starting model as Starting, a terminal failure as Failed', () => {
    expect(phasePresentation('ready')).toEqual({ text: 'Ready', color: 'green' });
    expect(phasePresentation('pending', 'Processing')).toEqual({ text: 'Pending', color: 'blue' });
    for (const reason of STARTING_REASONS) {
      expect(phasePresentation('failed', reason)).toEqual({ text: 'Starting', color: 'orange' });
    }
    expect(phasePresentation('failed', 'ConfigNotFound')).toEqual({ text: 'Failed', color: 'red' });
    expect(phasePresentation('failed', 'ProgressDeadlineExceeded')).toEqual({ text: 'Failed', color: 'red' });
    expect(phasePresentation('failed', 'NotAsExpected')).toEqual({ text: 'Failed', color: 'red' });
    expect(phasePresentation(undefined)).toEqual({ text: 'No status', color: 'grey' });
  });

  it('summarises the sites and maps the form to the body', () => {
    const models = seedModels();
    expect(sitesSummary(models[0])).toBe('Hub');
    expect(sitesSummary(models[1])).toBe('1 / 1 site');
    expect(sitesSummary(models[4])).toBe('0 / 0 sites');
    expect(locationsOf(new MockConsoleService().clusters)).toEqual(['paris']);
    const hub: FormValues = {
      name: ' m ',
      namespace: 'ns',
      displayName: '',
      description: '',
      modelUri: 'hf://x/m',
      modelName: '',
      runtimeImage: '',
      preset: '',
      replicas: '',
      cpu: '',
      memory: '',
      gpuCount: '0',
      target: 'hub',
      scope: 'locations',
      locations: [],
      strategy: 'All',
      maxConcurrency: '1',
    };
    expect(toCreateBody(hub)).toEqual({ name: 'm', namespace: 'ns', modelUri: 'hf://x/m' });
    expect(canDeploy(hub, 'error')).toBe(true);
    const sites: FormValues = { ...hub, target: 'sites' };
    expect(canDeploy(sites, 'ready')).toBe(false); // no location chosen
    expect(canDeploy({ ...sites, locations: ['paris'] }, 'ready')).toBe(true);
    expect(canDeploy({ ...sites, locations: ['paris'] }, 'loading')).toBe(false);
    expect(canDeploy({ ...sites, locations: ['paris'] }, 'error')).toBe(false);
    expect(canDeploy({ ...sites, scope: 'all' }, 'ready')).toBe(true);
    expect(canDeploy({ ...sites, scope: 'all' }, 'error')).toBe(false);
    // Only the explicit "all eligible sites" choice sends a placement without a location selector.
    expect(toCreateBody({ ...sites, scope: 'all' }).placement).toEqual({ clusterSets: ['global'], matchLabels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true' } });
    expect(toCreateBody({ ...sites, locations: ['paris'] }).placement?.matchExpressions).toEqual([{ key: 'location', operator: 'In', values: ['paris'] }]);
  });
});

describe('MockConsoleService models', () => {
  it('derives the placement decision and the rollout from the mock clusters like the fake backend', () => {
    const clusters = new MockConsoleService().clusters;
    const enabled: PlacementSpec = { matchLabels: { 'ai-grid/enabled': 'true' } };
    // paris is Ready; madrid (unknown) and ashburn (offline) carry untolerated hub taints.
    expect(selectClusters(enabled, clusters)).toEqual(['site-paris-1']);
    expect(selectClusters({ ...enabled, tolerations: [{ key: 'cluster.open-cluster-management.io/unreachable', operator: 'Exists' }] }, clusters)).toEqual(['site-madrid-1', 'site-paris-1']);
    expect(selectClusters({ matchLabels: { vendor: 'OpenShift' }, matchExpressions: [{ key: 'local-cluster', operator: 'NotIn', values: ['true'] }] }, clusters)).toEqual([
      'site-frankfurt-1',
      'site-paris-1',
    ]);
    expect(selectClusters({ matchExpressions: [{ key: 'ai-grid/region', operator: 'In', values: ['asia-east'] }] }, clusters)).toEqual([]);
    expect(selectClusters({ matchExpressions: [{ key: 'ai-grid/region', operator: 'Exists' }], numberOfClusters: 1 }, clusters)).toEqual(['site-paris-1']);

    const empty = rolloutFromWorks({ strategy: 'All' }, [], 0, 't');
    expect(empty.reason).toBe('PlacementDecisionEmpty');
    expect(placedPhase(empty)).toEqual({ phase: 'pending', reason: 'PlacementDecisionEmpty' });
    const waiting = rolloutFromWorks({ strategy: 'All' }, [], 2, 't');
    expect(waiting.reason).toBe('NotAsExpected');
    expect(placedPhase(waiting)).toEqual({ phase: 'pending', reason: 'NotAsExpected' });
  });

  it('applies the admission rules and the gate', async () => {
    const service = new MockConsoleService();
    await expect(service.createModel({ name: 'Bad', namespace: 'ns', modelUri: 'hf://x/y' })).rejects.toMatchObject({ status: 422 });
    await expect(service.createModel({ name: 'ok', namespace: 'ns', modelUri: 'ftp://x/y' })).rejects.toMatchObject({ status: 422 });
    await expect(service.createModel({ name: 'ok', namespace: 'ns', modelUri: 'hf://x/y', rollout: { strategy: 'All' } })).rejects.toMatchObject({ status: 422 });
    await expect(service.createModel({ name: 'tiny-llm', namespace: 'ai-grid-models', modelUri: 'hf://x/y' })).rejects.toMatchObject({ status: 409 });
    await expect(service.getModel('ns', 'nope')).rejects.toMatchObject({ status: 404 });
    const viewer = new MockConsoleService({ username: 'v', groups: [], isProviderAdmin: false });
    await expect(viewer.createModel({ name: 'ok', namespace: 'ns', modelUri: 'hf://x/y' })).rejects.toMatchObject({ status: 403 });
    await expect(viewer.deleteModel('ai-grid-models', 'tiny-llm')).rejects.toMatchObject({ status: 403 });
    const page = await service.listModels({ namespace: 'ai-grid-models', labels: { 'ai-grid/family': 'tiny' } });
    expect(page.items.map((m) => m.name)).toEqual(['tiny-llm']);
    expect(page.meta.total).toBe(1);
    const created = await service.createModel({ name: 'ok', namespace: 'ns', modelUri: 'hf://x/y', displayName: 'OK' });
    expect(created.phase).toBe('pending');
    expect(created.modelName).toBe('ok');
    expect(created.annotations['openshift.io/display-name']).toBe('OK');
    const updated = await service.updateModel('ns', 'ok', { replicas: 2, displayName: '', description: 'Described' });
    expect(updated.replicas).toBe(2);
    expect(updated.annotations['openshift.io/display-name']).toBeUndefined();
    expect(updated.description).toBe('Described');
    expect(updated.annotations['openshift.io/description']).toBe('Described');
    expect(updated.resourceVersion).not.toBe(created.resourceVersion);
    // Scaling and runtime are carried like the BFF carries them, with the CRD's rules.
    const scaled = await service.createModel({ name: 'scaled', namespace: 'ns', modelUri: 'hf://x/y', runtime: 'vllm-cuda', scaling: { minReplicas: 1, maxReplicas: 4, triggers: [{ type: 'cpu', metadata: { value: '80' } }] } });
    expect(scaled.runtime).toBe('vllm-cuda');
    expect(scaled.scaling).toEqual({ minReplicas: 1, maxReplicas: 4, triggers: [{ type: 'cpu', metadata: { value: '80' } }] });
    expect(scaled.replicas).toBeUndefined();
    await expect(service.createModel({ name: 's2', namespace: 'ns', modelUri: 'hf://x/y', replicas: 1, scaling: { minReplicas: 1, maxReplicas: 4, triggers: [{ type: 'cpu' }] } })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('mutually exclusive') });
    await expect(service.createModel({ name: 's3', namespace: 'ns', modelUri: 'hf://x/y', scaling: { minReplicas: 1, maxReplicas: 4, triggers: [] } })).rejects.toMatchObject({ status: 422, message: 'at least one trigger is required when using direct KEDA scaling' });
    await expect(service.createModel({ name: 's4', namespace: 'ns', modelUri: 'hf://x/y', scaling: { minReplicas: 5, maxReplicas: 4, triggers: [{ type: 'cpu' }] } })).rejects.toMatchObject({ status: 422, message: 'minReplicas cannot exceed maxReplicas' });
    // A rollout-only patch changes the strategy of a placed model and is refused on a hub one.
    const rolled = await service.updateModel('ai-grid-models', 'granite-8b-instruct', { rollout: { strategy: 'Progressive', maxConcurrency: '1' } });
    expect(rolled.rollout?.strategy).toBe('Progressive');
    expect(rolled.rollout?.maxConcurrency).toBe('1');
    expect(rolled.rollout?.works).toHaveLength(1);
    expect(rolled.phase).toBe('ready');
    await expect(service.updateModel('ns', 'ok', { rollout: { strategy: 'All' } })).rejects.toMatchObject({ status: 422, message: 'spec.rollout requires spec.placement' });
    // A custom resource name is a DNS-1123 subdomain; a namespace a label.
    await expect(service.createModel({ name: 'granite.3b', namespace: 'ns', modelUri: 'hf://x/y' })).resolves.toMatchObject({ name: 'granite.3b' });
    await expect(service.createModel({ name: 'ok2', namespace: 'a.b', modelUri: 'hf://x/y' })).rejects.toMatchObject({ status: 422, message: expect.stringContaining('RFC 1123 label') });
  });
});

/**
 * The browser mock must not drift from the fake backend's fixture: same
 * models, specs, placements, rollout strategies and labels, and a phase
 * consistent with the fixture (an installed preset or not, a placement).
 */
describe('seedModels mirrors mock/fixtures/models.json', () => {
  type Fixture = {
    name: string;
    metadata: { namespace: string; resourceVersion?: string; creationTimestamp?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
    spec: {
      model: { uri: string; name?: string };
      replicas?: number;
      baseRefs?: string[];
      main?: { image?: string; requests?: Record<string, string>; limits?: Record<string, string>; env?: { name: string; value: string }[] };
      router?: { gatewayRefs?: { name: string; namespace: string }[] };
      placement?: { clusterSets?: string[]; labelSelector?: { matchLabels?: Record<string, string>; matchExpressions?: { key: string; operator: string; values?: string[] }[] } };
      rollout?: { strategy?: string; maxConcurrency?: string; maxFailures?: string; progressDeadline?: string; minSuccessTime?: string };
    };
    status?: unknown;
  };
  const fixtures = JSON.parse(readFileSync(join(process.cwd(), '..', 'mock', 'fixtures', 'models.json'), 'utf8')) as { models: Fixture[] };
  const presets = JSON.parse(readFileSync(join(process.cwd(), '..', 'mock', 'fixtures', 'presets.json'), 'utf8')) as { presets: string[] };
  const strategy = (s?: string) => (s === 'ROLLOUT_STRATEGY_PROGRESSIVE' ? 'Progressive' : s === 'ROLLOUT_STRATEGY_PROGRESSIVE_PER_GROUP' ? 'ProgressivePerGroup' : 'All');

  it('has the same models with the same spec, labels, placement and rollout', () => {
    const seeds = new Map(seedModels().map((m) => [`${m.namespace}/${m.name}`, m]));
    expect([...seeds.keys()].sort()).toEqual(fixtures.models.map((f) => `${f.metadata.namespace}/${f.name}`).sort());
    expect(presets.presets).toEqual(INSTALLED_PRESETS);
    for (const f of fixtures.models) {
      const s = seeds.get(`${f.metadata.namespace}/${f.name}`) as Model;
      expect(f.status, f.name).toBeUndefined();
      expect(s.modelUri, f.name).toBe(f.spec.model.uri);
      expect(s.modelName, f.name).toBe(f.spec.model.name ?? f.name);
      expect(s.replicas, f.name).toBe(f.spec.replicas);
      expect(s.baseRefs, f.name).toEqual(f.spec.baseRefs ?? []);
      expect(s.runtimeImage, f.name).toBe(f.spec.main?.image);
      expect(s.requests, f.name).toEqual(f.spec.main?.requests ?? {});
      expect(s.limits, f.name).toEqual(f.spec.main?.limits ?? {});
      expect(s.env, f.name).toEqual(f.spec.main?.env ?? []);
      expect(s.gateways, f.name).toEqual(f.spec.router?.gatewayRefs ?? []);
      expect(s.labels, f.name).toEqual(f.metadata.labels ?? {});
      expect(s.annotations, f.name).toEqual(f.metadata.annotations ?? {});
      expect(s.displayName, f.name).toBe(f.metadata.annotations?.['openshift.io/display-name']);
      expect(s.description, f.name).toBe(f.metadata.annotations?.['openshift.io/description']);
      if (f.metadata.resourceVersion) {
        expect(s.resourceVersion, f.name).toBe(f.metadata.resourceVersion);
      }
      if (f.metadata.creationTimestamp) {
        expect(s.creationTimestamp, f.name).toBe(f.metadata.creationTimestamp);
      }
      if (f.spec.placement) {
        expect(s.placement, f.name).toBeDefined();
        expect(s.placement?.clusterSets, f.name).toEqual(f.spec.placement.clusterSets);
        expect(s.placement?.matchLabels, f.name).toEqual(f.spec.placement.labelSelector?.matchLabels);
        expect(s.placement?.matchExpressions, f.name).toEqual(f.spec.placement.labelSelector?.matchExpressions);
        expect(s.rollout?.strategy, f.name).toBe(strategy(f.spec.rollout?.strategy));
        expect(s.rollout?.maxConcurrency, f.name).toBe(f.spec.rollout?.maxConcurrency);
        expect(s.rollout?.progressDeadline, f.name).toBe(f.spec.rollout?.progressDeadline);
        expect(s.rollout?.minSuccessTime, f.name).toBe(f.spec.rollout?.minSuccessTime);
        // The seed's decision is what the mock clusters yield for the same selector.
        expect(s.placement?.selectedClusters, f.name).toEqual(selectClusters(s.placement as PlacementSpec, new MockConsoleService().clusters));
        expect(s.conditions, f.name).toEqual([]);
      } else {
        expect(s.placement, f.name).toBeUndefined();
        const unknownPreset = (f.spec.baseRefs ?? []).find((ref) => !presets.presets.includes(ref));
        expect(s.phase, f.name).toBe(unknownPreset ? 'failed' : 'ready');
        if (unknownPreset) {
          expect(s.reason, f.name).toBe('ConfigNotFound');
          expect(s.message, f.name).toBe(`LLMInferenceServiceConfig "${unknownPreset}" not found in namespaces [${f.metadata.namespace} redhat-ods-applications]`);
        } else {
          expect(s.conditions.map((c) => c.type), f.name).toEqual(
            ['GatewaysReady', 'HTTPRoutesReady', 'InferencePoolReady', 'MainWorkloadReady', 'PresetsCombined', 'Ready', 'RouterReady', 'SchedulerWorkloadReady', 'WorkloadsReady'],
          );
          expect(s.addresses, f.name).toHaveLength(6);
          expect(s.url, f.name).toBe(`https://openshift-ai-inference.apps.hub.example.com/${f.metadata.namespace}/${f.name}`);
        }
      }
    }
  });
});
