import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  Spinner,
  Stack,
  StackItem,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { EllipsisVIcon } from '@patternfly/react-icons';
import { ActionsColumn, ExpandableRowContent, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { ConsoleService } from '../api/ConsoleService';
import { ServiceError } from '../api/ConsoleService';
import type { Capabilities, ClusterCondition, GridCluster, Model, ModelCreate, ModelPhase, RolloutStrategy, WorkStatus } from '../api/types';
import { LoadError } from '../components/LoadError';
import { useServiceData } from '../hooks/useServiceData';

type Props = {
  service: ConsoleService;
  /**
   * Whether the signed-in user may deploy, edit and delete models (a
   * provider admin). The backend still authorizes every write; this only
   * shows or hides the actions.
   */
  canEdit: boolean;
};

type LabelColor = React.ComponentProps<typeof Label>['color'];

/**
 * `Ready=False` reasons KServe reports while a healthy model is still starting
 * (the managed route not yet observed, the Deployment not yet available). The
 * backend derives `failed` for every `Ready=False`, as KServe does; the page
 * shows these as "Starting" rather than "Failed" so a model that is coming up
 * does not read as broken. `MinimumReplicasUnavailable` turns into
 * `ProgressDeadlineExceeded` after the Deployment's progress deadline, which
 * is a real failure. See mock/research/models-maas.md 2.1.
 */
export const STARTING_REASONS = ['HTTPRouteNotObserved', 'WaitingForGateway', 'Progressing', 'MinimumReplicasUnavailable'];

export type PhasePresentation = { text: string; color: LabelColor };

/** How a phase and its reason are shown. */
export const phasePresentation = (phase: ModelPhase | undefined, reason?: string): PhasePresentation => {
  switch (phase) {
    case 'ready':
      return { text: 'Ready', color: 'green' };
    case 'failed':
      return reason && STARTING_REASONS.includes(reason) ? { text: 'Starting', color: 'orange' } : { text: 'Failed', color: 'red' };
    case 'pending':
      return { text: 'Pending', color: 'blue' };
    default:
      return { text: 'No status', color: 'grey' };
  }
};

const PhaseLabel: React.FC<{ model: Model }> = ({ model }) => {
  const { text, color } = phasePresentation(model.phase, model.reason);
  const title = [model.reason, model.message].filter(Boolean).join(': ');
  return (
    <span data-testid={`phase-${model.name}`}>
      <Label color={color} title={title || undefined}>
        {text}
      </Label>
      {model.reason && (
        <>
          {' '}
          <small>{model.reason}</small>
        </>
      )}
    </span>
  );
};

/** "Hub" for a hub deployment, otherwise applied / selected sites. */
export const sitesSummary = (m: Model): string => {
  if (!m.placement || !m.rollout) {
    return 'Hub';
  }
  const selected = m.placement.selectedClusters.length;
  const done = m.rollout.works.filter((w) => w.applied === 'True' && w.progressing === 'False').length;
  return `${done} / ${selected} site${selected === 1 ? '' : 's'}`;
};

const statusColor = (status: ClusterCondition['status'] | undefined): LabelColor => (status === 'True' ? 'green' : status === 'False' ? 'red' : 'grey');

const ConditionsTable: React.FC<{ conditions: ClusterCondition[]; label: string }> = ({ conditions, label }) =>
  conditions.length === 0 ? (
    <small>No conditions yet.</small>
  ) : (
    <Table aria-label={label} variant="compact" borders={false}>
      <Thead>
        <Tr>
          <Th>Type</Th>
          <Th>Status</Th>
          <Th>Reason</Th>
          <Th>Message</Th>
        </Tr>
      </Thead>
      <Tbody>
        {conditions.map((c) => (
          <Tr key={c.type}>
            <Td dataLabel="Type">{c.type}</Td>
            <Td dataLabel="Status">
              <Label isCompact color={statusColor(c.status)}>
                {c.status}
              </Label>
            </Td>
            <Td dataLabel="Reason">{c.reason ?? '-'}</Td>
            <Td dataLabel="Message">{c.message ?? '-'}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );

const WorkCell: React.FC<{ status?: ClusterCondition['status'] }> = ({ status }) =>
  status ? (
    <Label isCompact color={statusColor(status)}>
      {status}
    </Label>
  ) : (
    <small>-</small>
  );

const WorksTable: React.FC<{ works: WorkStatus[]; model: Model }> = ({ works, model }) =>
  works.length === 0 ? (
    <small>No ManifestWork yet.</small>
  ) : (
    <Table aria-label={`Sites of ${model.name}`} variant="compact" borders={false}>
      <Thead>
        <Tr>
          <Th>Site</Th>
          <Th modifier="fitContent">Applied</Th>
          <Th modifier="fitContent">Available</Th>
          <Th modifier="fitContent">Progressing</Th>
          <Th modifier="fitContent">Degraded</Th>
          <Th modifier="fitContent">Ready</Th>
          <Th>URL</Th>
        </Tr>
      </Thead>
      <Tbody>
        {works.map((w) => (
          <Tr key={w.cluster} data-testid={`work-${model.name}-${w.cluster}`}>
            <Td dataLabel="Site">
              {w.cluster}
              <div>
                <small>{w.workName}</small>
              </div>
            </Td>
            <Td dataLabel="Applied">
              <WorkCell status={w.applied} />
            </Td>
            <Td dataLabel="Available">
              <WorkCell status={w.available} />
            </Td>
            <Td dataLabel="Progressing">
              <WorkCell status={w.progressing} />
            </Td>
            <Td dataLabel="Degraded">
              <WorkCell status={w.degraded} />
            </Td>
            <Td dataLabel="Ready">{w.feedback.ready ?? '-'}</Td>
            <Td dataLabel="URL">
              {w.feedback.url ? (
                <a href={w.feedback.url} target="_blank" rel="noreferrer">
                  {w.feedback.url}
                </a>
              ) : (
                '-'
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );

const ModelDetails: React.FC<{ model: Model }> = ({ model }) => (
  <Stack hasGutter>
    <StackItem>
      <DescriptionList isHorizontal isCompact>
        <DescriptionListGroup>
          <DescriptionListTerm>Model URI</DescriptionListTerm>
          <DescriptionListDescription>{model.modelUri}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Model name</DescriptionListTerm>
          <DescriptionListDescription>{model.modelName}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Runtime image</DescriptionListTerm>
          <DescriptionListDescription>{model.runtimeImage || 'From the preset'}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Presets</DescriptionListTerm>
          <DescriptionListDescription>{model.baseRefs.length ? model.baseRefs.join(', ') : '-'}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Requests</DescriptionListTerm>
          <DescriptionListDescription>
            {Object.entries(model.requests)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ') || '-'}
          </DescriptionListDescription>
        </DescriptionListGroup>
        {model.env.length > 0 && (
          <DescriptionListGroup>
            <DescriptionListTerm>Environment</DescriptionListTerm>
            <DescriptionListDescription>{model.env.map((e) => `${e.name}=${e.value}`).join(', ')}</DescriptionListDescription>
          </DescriptionListGroup>
        )}
        {model.message && (
          <DescriptionListGroup>
            <DescriptionListTerm>Message</DescriptionListTerm>
            <DescriptionListDescription>{model.message}</DescriptionListDescription>
          </DescriptionListGroup>
        )}
      </DescriptionList>
    </StackItem>
    {model.placement && model.rollout ? (
      <>
        <StackItem>
          <Title headingLevel="h4" size="md">
            Placement
          </Title>
          <DescriptionList isHorizontal isCompact>
            <DescriptionListGroup>
              <DescriptionListTerm>Selector</DescriptionListTerm>
              <DescriptionListDescription>
                {[
                  ...Object.entries(model.placement.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`),
                  ...(model.placement.matchExpressions ?? []).map((e) => `${e.key} ${e.operator} ${e.values?.length ? `[${e.values.join(', ')}]` : ''}`.trim()),
                ].join(', ') || 'every cluster'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Decision</DescriptionListTerm>
              <DescriptionListDescription>
                <Label isCompact color={model.placement.satisfied ? 'green' : 'orange'} title={model.placement.message}>
                  {model.placement.reason ?? 'unknown'}
                </Label>{' '}
                {model.placement.selectedClusters.length ? model.placement.selectedClusters.join(', ') : 'no cluster selected'}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Rollout</DescriptionListTerm>
              <DescriptionListDescription>
                {model.rollout.strategy}
                {model.rollout.maxConcurrency ? `, ${model.rollout.maxConcurrency} at a time` : ''}
                {model.rollout.progressDeadline ? `, deadline ${model.rollout.progressDeadline}` : ''}
                {' / '}
                {`${model.rollout.summary.available} of ${model.rollout.summary.total} available, ${model.rollout.summary.progressing} progressing, ${model.rollout.summary.degraded} degraded`}
                {model.rollout.reason ? ` (${model.rollout.reason})` : ''}
              </DescriptionListDescription>
            </DescriptionListGroup>
          </DescriptionList>
        </StackItem>
        <StackItem>
          <WorksTable works={model.rollout.works} model={model} />
        </StackItem>
      </>
    ) : (
      <StackItem>
        <ConditionsTable conditions={model.conditions} label={`Conditions of ${model.name}`} />
      </StackItem>
    )}
  </Stack>
);

export type FormValues = {
  name: string;
  namespace: string;
  displayName: string;
  description: string;
  modelUri: string;
  modelName: string;
  runtimeImage: string;
  preset: string;
  replicas: string;
  cpu: string;
  memory: string;
  gpuCount: string;
  target: 'hub' | 'sites';
  /** With `sites`: the chosen locations, or every eligible site (an explicit choice). */
  scope: 'locations' | 'all';
  locations: string[];
  strategy: RolloutStrategy;
  maxConcurrency: string;
};

const emptyForm: FormValues = {
  name: '',
  namespace: 'ai-grid-models',
  displayName: '',
  description: '',
  modelUri: '',
  modelName: '',
  runtimeImage: '',
  preset: 'v3-6-0-kserve-config-llm-template',
  replicas: '1',
  cpu: '',
  memory: '',
  gpuCount: '0',
  target: 'hub',
  scope: 'locations',
  locations: [],
  strategy: 'All',
  maxConcurrency: '1',
};

/** The POC's deploy wizard inputs mapped to the request (mock/research/models-maas.md 7.3). */
export const toCreateBody = (f: FormValues): ModelCreate => {
  const body: ModelCreate = {
    name: f.name.trim(),
    namespace: f.namespace.trim(),
    modelUri: f.modelUri.trim(),
    ...(f.displayName.trim() ? { displayName: f.displayName.trim() } : {}),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    ...(f.modelName.trim() ? { modelName: f.modelName.trim() } : {}),
    ...(f.runtimeImage.trim() ? { runtimeImage: f.runtimeImage.trim() } : {}),
    ...(f.preset.trim() ? { baseRefs: [f.preset.trim()] } : {}),
    ...(f.replicas.trim() ? { replicas: Number(f.replicas) } : {}),
    ...(f.cpu.trim() ? { cpu: f.cpu.trim() } : {}),
    ...(f.memory.trim() ? { memory: f.memory.trim() } : {}),
    ...(Number(f.gpuCount) > 0 ? { gpuCount: Number(f.gpuCount) } : {}),
  };
  if (f.target === 'sites') {
    // The POC's Placement: enrolled and provisioned clusters, in the chosen
    // locations; a placement without a location selector is only sent when
    // "all eligible sites" was chosen explicitly.
    body.placement = {
      clusterSets: ['global'],
      matchLabels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true' },
      ...(f.scope === 'locations' ? { matchExpressions: [{ key: 'location', operator: 'In', values: [...f.locations].sort() }] } : {}),
    };
    body.rollout = f.strategy === 'Progressive' ? { strategy: 'Progressive', maxConcurrency: f.maxConcurrency.trim() || '1', progressDeadline: '15m' } : { strategy: 'All', progressDeadline: '15m' };
  }
  return body;
};

/** Whether the deploy form can be submitted: the required fields, and for sites a finished cluster discovery and an explicit scope. */
export const canDeploy = (f: FormValues, discovery: DiscoveryState): boolean =>
  f.name.trim() !== '' &&
  f.namespace.trim() !== '' &&
  f.modelUri.trim() !== '' &&
  (f.target === 'hub' || (discovery === 'ready' && (f.scope === 'all' || f.locations.length > 0)));

export type DiscoveryState = 'idle' | 'loading' | 'ready' | 'error';

/** Locations offered for placement: the `location` labels of the clusters that are Ready, enrolled and provisioned (the POC's GET /api/locations). */
export const locationsOf = (clusters: GridCluster[]): string[] =>
  [...new Set(clusters.filter((c) => c.status === 'ready' && c.aiGridEnabled && c.provisioned && c.location).map((c) => c.location as string))].sort();

export const ModelsPage: React.FC<Props> = ({ service, canEdit }) => {
  const [models, loaded, error, refresh] = useServiceData<Model[]>(() => service.listModels().then((p) => p.items), [], 10000);
  const [capabilities, setCapabilities] = useState<Capabilities | undefined>();
  const [clusters, setClusters] = useState<GridCluster[]>([]);
  // Cluster discovery for the deploy form is tracked on its own: a failed or
  // pending discovery must not read as "no locations", which would let a
  // placement without a selector through.
  const [discovery, setDiscovery] = useState<DiscoveryState>('idle');
  const [discoveryError, setDiscoveryError] = useState<Error | undefined>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [actionError, setActionError] = useState<{ name: string; verb: string; error: Error } | undefined>();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [formError, setFormError] = useState<Error | undefined>();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Model | undefined>();
  const [replicas, setReplicas] = useState('1');
  const [deleting, setDeleting] = useState<Model | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  useEffect(() => {
    // A backend without the RPC answers 501: the gate is then unknown and the page says nothing about it.
    service
      .getCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(undefined));
  }, [service]);

  const loadClusters = useCallback(() => {
    setDiscovery('loading');
    setDiscoveryError(undefined);
    service
      .listClusters()
      .then((list) => {
        setClusters(list);
        setDiscovery('ready');
      })
      .catch((e) => {
        setClusters([]);
        setDiscoveryError(e instanceof Error ? e : new Error(String(e)));
        setDiscovery('error');
      });
  }, [service]);

  const gateOff = capabilities !== undefined && !capabilities.manifestWorkReplicaSetEnabled;
  const locations = useMemo(() => locationsOf(clusters), [clusters]);
  const key = (m: Model) => `${m.namespace}/${m.name}`;

  const toggle = (m: Model) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key(m))) {
        next.delete(key(m));
      } else {
        next.add(key(m));
      }
      return next;
    });

  const runAction = async (m: Model, verb: string, action: () => Promise<unknown>) => {
    setBusy(key(m));
    setActionError(undefined);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError({ name: m.name, verb, error: e instanceof Error ? e : new Error(String(e)) });
    } finally {
      setBusy(undefined);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(undefined);
    setCreating(true);
    loadClusters();
  };

  const submitCreate = async () => {
    setSaving(true);
    setFormError(undefined);
    try {
      await service.createModel(toCreateBody(form));
      setCreating(false);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setSaving(false);
    }
  };

  const submitReplicas = async () => {
    if (!editing) {
      return;
    }
    const m = editing;
    setSaving(true);
    setFormError(undefined);
    try {
      await service.updateModel(m.namespace, m.name, { replicas: Number(replicas) });
      setEditing(undefined);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) {
      return;
    }
    const m = deleting;
    setDeleting(undefined);
    await runAction(m, 'deleted', () => service.deleteModel(m.namespace, m.name));
  };

  const set = (patch: Partial<FormValues>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h2">Models</Title>
      </StackItem>
      {gateOff && (
        <StackItem>
          <Alert variant="warning" isInline title="Multi-site placement is not available on this hub">
            The ManifestWorkReplicaSet feature gate is disabled on the hub (ACM {capabilities?.acmVersion || 'unknown version'}). Models can be deployed to the
            hub only; a placement would be refused with &quot;{'ManifestWorkReplicaSet feature gate disabled on hub'}&quot;.
          </Alert>
        </StackItem>
      )}
      {canEdit && (
        <StackItem>
          <Toolbar inset={{ default: 'insetNone' }}>
            <ToolbarContent>
              <ToolbarItem>
                <Button variant="primary" onClick={openCreate}>
                  Deploy model
                </Button>
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        </StackItem>
      )}
      {error && (
        <StackItem>
          <LoadError subject="Models" error={error} />
        </StackItem>
      )}
      {actionError && (
        <StackItem>
          <LoadError subject={`Model ${actionError.name}`} verb={actionError.verb} error={actionError.error} />
        </StackItem>
      )}
      <StackItem>
        {!loaded ? (
          <Spinner aria-label="Loading models" />
        ) : error ? null : models.length === 0 ? (
          <EmptyState titleText="No models" headingLevel="h3">
            <EmptyStateBody>No model is deployed on the grid yet.</EmptyStateBody>
          </EmptyState>
        ) : (
          <Table aria-label="Models" variant="compact">
            <Thead>
              <Tr>
                <Th screenReaderText="Details" />
                <Th>Name</Th>
                <Th>Phase</Th>
                <Th modifier="fitContent">Replicas</Th>
                <Th modifier="fitContent">Sites</Th>
                <Th>URL</Th>
                {canEdit && <Th modifier="fitContent" screenReaderText="Actions" />}
              </Tr>
            </Thead>
            {models.map((m, rowIndex) => {
              const isExpanded = expanded.has(key(m));
              return (
                <Tbody key={key(m)} isExpanded={isExpanded}>
                  <Tr>
                    <Td expand={{ rowIndex, isExpanded, onToggle: () => toggle(m), expandId: `model-${m.namespace}-${m.name}` }} />
                    <Td dataLabel="Name">
                      <span data-testid={`model-${m.name}`}>{m.displayName || m.name}</span>
                      <div>
                        <small>
                          {m.namespace}/{m.name}
                        </small>
                      </div>
                    </Td>
                    <Td dataLabel="Phase">
                      <PhaseLabel model={m} />
                    </Td>
                    <Td dataLabel="Replicas" modifier="fitContent">
                      {m.replicas ?? (m.scaling ? `${m.scaling.minReplicas}-${m.scaling.maxReplicas}` : '-')}
                    </Td>
                    <Td dataLabel="Sites" modifier="fitContent">
                      <span data-testid={`sites-${m.name}`}>{sitesSummary(m)}</span>
                    </Td>
                    <Td dataLabel="URL">
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noreferrer">
                          {m.url}
                        </a>
                      ) : (
                        '-'
                      )}
                    </Td>
                    {canEdit && (
                      <Td dataLabel="Actions" isActionCell>
                        <ActionsColumn
                          isDisabled={busy === key(m)}
                          actionsToggle={({ onToggle, isOpen, isDisabled, toggleRef }) => (
                            <MenuToggle
                              ref={toggleRef}
                              aria-label={`Actions for ${m.name}`}
                              variant="plain"
                              icon={<EllipsisVIcon />}
                              isExpanded={isOpen}
                              isDisabled={isDisabled}
                              onClick={onToggle}
                            />
                          )}
                          items={[
                            {
                              title: 'Edit replicas',
                              isDisabled: m.scaling !== undefined,
                              onClick: () => {
                                setReplicas(String(m.replicas ?? 1));
                                setFormError(undefined);
                                setEditing(m);
                              },
                            },
                            { isSeparator: true },
                            { title: 'Delete', onClick: () => setDeleting(m), isDanger: true },
                          ]}
                        />
                      </Td>
                    )}
                  </Tr>
                  <Tr isExpanded={isExpanded}>
                    <Td />
                    <Td dataLabel="Details" colSpan={canEdit ? 6 : 5}>
                      <ExpandableRowContent>{isExpanded && <ModelDetails model={m} />}</ExpandableRowContent>
                    </Td>
                  </Tr>
                </Tbody>
              );
            })}
          </Table>
        )}
      </StackItem>

      <Modal variant="medium" isOpen={creating} onClose={() => setCreating(false)} aria-labelledby="model-form-title">
        <ModalHeader title="Deploy model" labelId="model-form-title" />
        <ModalBody>
          <Form
            id="model-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
          >
            {formError && (
              <Alert variant={formError instanceof ServiceError && formError.status === 412 ? 'warning' : 'danger'} isInline title="Model could not be deployed">
                {formError.message}
              </Alert>
            )}
            <FormGroup label="Name" isRequired fieldId="model-name">
              <TextInput id="model-name" isRequired value={form.name} onChange={(_e, v) => set({ name: v })} />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>A DNS-1123 subdomain (lower case, digits, &apos;-&apos; and &apos;.&apos;), unique in the namespace.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Namespace" isRequired fieldId="model-namespace">
              <TextInput id="model-namespace" isRequired value={form.namespace} onChange={(_e, v) => set({ namespace: v })} />
            </FormGroup>
            <FormGroup label="Display name" fieldId="model-display-name">
              <TextInput id="model-display-name" value={form.displayName} onChange={(_e, v) => set({ displayName: v })} />
            </FormGroup>
            <FormGroup label="Description" fieldId="model-description">
              <TextInput id="model-description" value={form.description} onChange={(_e, v) => set({ description: v })} />
            </FormGroup>
            <FormGroup label="Model URI" isRequired fieldId="model-uri">
              <TextInput id="model-uri" isRequired value={form.modelUri} placeholder="hf://org/model, oci://..., s3://..., pvc://..." onChange={(_e, v) => set({ modelUri: v })} />
            </FormGroup>
            <FormGroup label="Model name" fieldId="model-model-name">
              <TextInput id="model-model-name" value={form.modelName} placeholder="Defaults to the name" onChange={(_e, v) => set({ modelName: v })} />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>What clients send in the request&apos;s model field.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Runtime image" fieldId="model-image">
              <TextInput id="model-image" value={form.runtimeImage} placeholder="From the preset when empty" onChange={(_e, v) => set({ runtimeImage: v })} />
            </FormGroup>
            <FormGroup label="Preset" fieldId="model-preset">
              <TextInput id="model-preset" value={form.preset} onChange={(_e, v) => set({ preset: v })} />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>An LLMInferenceServiceConfig installed on the hub (v3-6-0-kserve-config-llm-*).</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Replicas" fieldId="model-replicas">
              <TextInput id="model-replicas" type="number" min={0} value={form.replicas} onChange={(_e, v) => set({ replicas: v })} />
            </FormGroup>
            <FormGroup label="CPU" fieldId="model-cpu">
              <TextInput id="model-cpu" value={form.cpu} placeholder="e.g. 4" onChange={(_e, v) => set({ cpu: v })} />
            </FormGroup>
            <FormGroup label="Memory" fieldId="model-memory">
              <TextInput id="model-memory" value={form.memory} placeholder="e.g. 16Gi" onChange={(_e, v) => set({ memory: v })} />
            </FormGroup>
            <FormGroup label="GPUs" fieldId="model-gpu">
              <TextInput id="model-gpu" type="number" min={0} value={form.gpuCount} onChange={(_e, v) => set({ gpuCount: v })} />
            </FormGroup>
            <FormGroup label="Deploy to" role="radiogroup" isInline fieldId="model-target">
              <Radio id="model-target-hub" name="model-target" label="Hub only" isChecked={form.target === 'hub'} onChange={() => set({ target: 'hub' })} />
              <Radio
                id="model-target-sites"
                name="model-target"
                label="Sites by location"
                isChecked={form.target === 'sites'}
                isDisabled={gateOff}
                description={gateOff ? 'Not available: the ManifestWorkReplicaSet gate is disabled on this hub.' : undefined}
                onChange={() => set({ target: 'sites' })}
              />
            </FormGroup>
            {form.target === 'sites' && (
              <>
                <FormGroup label="Sites" role="radiogroup" fieldId="model-scope">
                  <Radio
                    id="model-scope-locations"
                    name="model-scope"
                    label="Selected locations"
                    isChecked={form.scope === 'locations'}
                    onChange={() => set({ scope: 'locations' })}
                  />
                  <Radio
                    id="model-scope-all"
                    name="model-scope"
                    label="All eligible sites"
                    description="Every enrolled and provisioned site, including sites enrolled later."
                    isChecked={form.scope === 'all'}
                    onChange={() => set({ scope: 'all' })}
                  />
                </FormGroup>
                {discovery === 'error' && (
                  <Alert variant="danger" isInline title="Sites could not be loaded" data-testid="discovery-error">
                    {discoveryError?.message}{' '}
                    <Button variant="link" isInline onClick={loadClusters}>
                      Retry
                    </Button>
                  </Alert>
                )}
                {form.scope === 'locations' && (
                  <FormGroup label="Locations" fieldId="model-locations">
                    {discovery === 'loading' || discovery === 'idle' ? (
                      <HelperText>
                        <HelperTextItem>Loading the sites...</HelperTextItem>
                      </HelperText>
                    ) : discovery === 'error' ? (
                      <HelperText>
                        <HelperTextItem>Retry the site discovery, or deploy to the hub only.</HelperTextItem>
                      </HelperText>
                    ) : locations.length === 0 ? (
                      <HelperText>
                        <HelperTextItem>No Ready, enrolled and provisioned site has a location label; choose "All eligible sites" to place without one.</HelperTextItem>
                      </HelperText>
                    ) : (
                      locations.map((loc) => (
                        <Checkbox
                          key={loc}
                          id={`model-location-${loc}`}
                          label={loc}
                          isChecked={form.locations.includes(loc)}
                          onChange={(_e, checked) => set({ locations: checked ? [...form.locations, loc] : form.locations.filter((l) => l !== loc) })}
                        />
                      ))
                    )}
                  </FormGroup>
                )}
                <FormGroup label="Rollout" fieldId="model-strategy">
                  <FormSelect id="model-strategy" value={form.strategy} onChange={(_e, v) => set({ strategy: v as RolloutStrategy })}>
                    <FormSelectOption value="All" label="All sites at once" />
                    <FormSelectOption value="Progressive" label="Progressive, one batch at a time" />
                  </FormSelect>
                </FormGroup>
                {form.strategy === 'Progressive' && (
                  <FormGroup label="Sites per batch" fieldId="model-concurrency">
                    <TextInput id="model-concurrency" value={form.maxConcurrency} placeholder="1 or 20%" onChange={(_e, v) => set({ maxConcurrency: v })} />
                  </FormGroup>
                )}
              </>
            )}
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" type="submit" form="model-form" isLoading={saving} isDisabled={saving || !canDeploy(form, discovery)}>
            Deploy
          </Button>
          <Button variant="link" onClick={() => setCreating(false)} isDisabled={saving}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal variant="small" isOpen={editing !== undefined} onClose={() => setEditing(undefined)} aria-labelledby="model-replicas-title">
        <ModalHeader title={`Edit replicas of ${editing?.name ?? ''}`} labelId="model-replicas-title" />
        <ModalBody>
          <Form
            id="model-replicas-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitReplicas();
            }}
          >
            {formError && (
              <Alert variant="danger" isInline title="Model could not be updated">
                {formError.message}
              </Alert>
            )}
            <FormGroup label="Replicas" isRequired fieldId="edit-replicas">
              <TextInput id="edit-replicas" type="number" min={0} value={replicas} onChange={(_e, v) => setReplicas(v)} />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>A change rolls the Deployment out again on every site.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" type="submit" form="model-replicas-form" isLoading={saving} isDisabled={saving || replicas.trim() === '' || Number(replicas) < 0}>
            Save
          </Button>
          <Button variant="link" onClick={() => setEditing(undefined)} isDisabled={saving}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal variant="small" isOpen={deleting !== undefined} onClose={() => setDeleting(undefined)} aria-labelledby="model-delete-title">
        <ModalHeader title={`Delete model ${deleting?.name ?? ''}?`} labelId="model-delete-title" titleIconVariant="warning" />
        <ModalBody>
          {deleting?.placement
            ? 'The Placement and the ManifestWorkReplicaSet are removed at once; each site stops serving the model shortly after.'
            : 'The LLMInferenceService is removed from the hub.'}{' '}
          A model that a catalog entry or a subscription references cannot be deleted.
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={() => void confirmDelete()}>
            Delete
          </Button>
          <Button variant="link" onClick={() => setDeleting(undefined)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </Stack>
  );
};
