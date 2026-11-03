// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/models/ModelWizard.tsx at 62319b8.
// Adapted from packages/model-serving/src/components/deploymentWizard/ModelDeploymentWizard.tsx,
// steps/ModelSourceStep.tsx, steps/ModelDeploymentStep.tsx and steps/ReviewStep.tsx.
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Standalone fields replace cluster catalogs and dynamic deployment plugins.
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  AlertActionLink,
  Breadcrumb,
  BreadcrumbItem,
  ExpandableSection,
  Flex,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  PageSection,
  Radio,
  Spinner,
  TextInput,
  Wizard,
  WizardStep,
  useWizardContext,
} from '@patternfly/react-core';
import { ServiceError } from '../../api/ConsoleService';
import { ConsoleWizardFooter } from '../../components/ConsoleWizardFooter';
import { CountInput } from '../../components/CountInput';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { K8sNameDescriptionField } from '../../components/K8sNameDescriptionField/K8sNameDescriptionField';
import { useK8sNameDescriptionFieldData } from '../../components/K8sNameDescriptionField/useK8sNameDescriptionFieldData';
import { MultiSelection } from '../../components/MultiSelection';
import { PageHeader } from '../../components/PageHeader';
import { ReadOnlyField } from '../../components/ReadOnlyField';
import { useConsoleSession } from '../../context/useConsoleSession';
import { useConfirmDiscard } from '../../hooks/useConfirmDiscard';
import { createModelSchema, fieldMessage } from '../../validation';
import { RuntimeArgsField } from './fields/RuntimeArgsField';
import { filterRuntimeArgsForContainer, runtimeArgsOf, type RuntimeArgsFieldData } from './fields/runtimeArgs';
import {
  DEFAULT_IMAGE,
  NVIDIA_GPU,
  acceleratorLabel,
  hardwareEnv,
  hardwareText,
  runtimeImageHelp,
} from './modelHardware';
import { DEFAULT_REPLICAS, sameSet, updateRequestOf, type ModelInput } from './modelRequests';
import { titleOf, type ModelView } from './modelView';
import { OlderServedNameAlert } from './OlderServedNameAlert';
import { useModelWrites, usePlacementClusters } from './useModels';
import { deploymentNameFromUri, modelPath } from './modelUtils';
import { useClusterList } from '../clusters/useClusters';

type Props = {
  /** The model to edit; without it the wizard deploys a new one. */
  model?: ModelView;
};

const steps = {
  source: 'source-model-step',
  deployment: 'model-deployment-step',
  clusters: 'clusters-step',
  review: 'summary-step',
} as const;

/** What the wizard starts from where the selected hardware sets no default. */
const defaults = { replicas: String(DEFAULT_REPLICAS), cpu: '2', memory: '4Gi', accelerators: '1' };

/** The most accelerators the wizard requests (createModelSchema's acceleratorCount). */
const MAX_ACCELERATORS = 64;

/** A resource the model was deployed without, shown in its read-only field. */
const NOT_SET = 'Not set';

const fixedReason = {
  source: 'The model a deployment serves is fixed. Deploy a new model to serve another one.',
  // Says what the field is without claiming a model deployed earlier serves its resource name: one
  // written before the backend served models as their ids can keep another.
  served: 'Users send this name as the model in their requests. It cannot be edited.',
  resources: 'Resources are set when the model is deployed. Deploy it again to change them.',
  hardware: 'Hardware is set when the model is deployed. Deploy it again to change it.',
  presets: 'Set when the model was deployed. New models are deployed without presets.',
};

/** The wizard's starting values: the defaults when deploying, the model's own when editing. */
const initialValues = (model?: ModelView) => ({
  modelUri: model?.modelUri ?? '',
  replicas: model?.replicas !== undefined ? String(model.replicas) : defaults.replicas,
  runtimeArgs: runtimeArgsOf(model?.env),
  // Only a `name In [...]` placement can be edited as a list of clusters (placementClustersOf).
  clusterNames: model?.placementClusters ?? [],
});

/** A field's help line, replaced by the field's error while it has one. */
const Help: React.FC<{ children: React.ReactNode; error?: string; id?: string }> = ({ children, error, id }) => (
  <FormHelperText>
    <HelperText id={id}>
      <HelperTextItem variant={error ? 'error' : 'default'}>{error ?? children}</HelperTextItem>
    </HelperText>
  </FormHelperText>
);

const notAvailable = (err: unknown, what: string) =>
  err instanceof ServiceError && err.isNotImplemented ? `${what} not available on this AI Grid backend.` : undefined;

/** Says which chosen clusters are no longer offered; undefined when none are. */
const goneClustersError = (names: string[]) =>
  names.length === 0
    ? undefined
    : `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} no longer available. Remove ${names.length === 1 ? 'it' : 'them'} to continue.`;

type ReviewItem = { term: string; value?: string };

/**
 * The Review step: an alert about the choices or the model first, if there is one, spaced as the
 * sections are; each section's Edit link goes back to its step.
 */
const ReviewStep: React.FC<{
  sections: { title: string; step: string; items: ReviewItem[] }[];
  alert?: React.ReactNode;
}> = ({ sections, alert }) => {
  const { goToStepById } = useWizardContext();
  return (
    <Flex
      direction={{ default: 'column' }}
      flexWrap={{ default: 'nowrap' }}
      spaceItems={{ default: 'spaceItemsXl' }}
      data-testid="model-review"
    >
      {alert}
      {sections.map((section) => (
        <DetailsSection key={section.title} title={section.title} onEdit={() => goToStepById(section.step)}>
          <DetailsList items={section.items} hideEmpty aria-label={section.title} />
        </DetailsSection>
      ))}
    </Flex>
  );
};

/**
 * The four-step deploy wizard at /models/deploy: source, deployment, clusters, review. With
 * `model` it edits that deployment at /models/:id/edit through the same steps: every step can be
 * opened from the start, the fields the console doesn't edit are read-only, and Save changes sends
 * only what changed (Models/Update with its mask).
 */
export const ModelWizard: React.FC<Props> = ({ model }) => {
  const navigate = useNavigate();
  const editing = !!model;
  const [start] = useState(() => initialValues(model));
  // Editing any other placement as a list of clusters would change what else it selects.
  const clustersEditable = !model || model.placementClusters !== undefined;
  const replicasEditable = !model?.autoscaled;
  const writes = useModelWrites();
  const { config, configError, reloadConfig } = useConsoleSession();
  const hardwareList = config?.models?.hardware ?? [];
  const {
    data: placementClusters,
    loaded: placementClustersLoaded,
    error: placementClustersError,
    refresh: reloadPlacementClusters,
  } = usePlacementClusters();
  const { data: clusters, refresh: reloadClusters } = useClusterList();
  // Each offered cluster's site and region, the description under its name.
  const clusterDescriptions = useMemo(
    () =>
      new Map(
        clusters.flatMap((c) => {
          const where = [c.siteName, c.region].filter(Boolean).join(' · ');
          return where ? [[c.name, where] as const] : [];
        }),
      ),
    [clusters],
  );
  // AI Grid members ListPlacementClusters doesn't offer: not Available, not Compliant, or not a cluster
  // that serves models (role inference or combined).
  const unavailableMembers = clusters.filter((c) => c.aiGridEnabled && !placementClusters.includes(c.name)).length;
  const [clusterNames, setClusterNames] = useState<string[]>(start.clusterNames);
  // True from entering the Clusters step until its placement clusters reload answers; Next waits for it.
  const [reloadingPlacementClusters, setReloadingPlacementClusters] = useState(false);
  const reloadRef = useRef(0);
  // Chosen clusters that a reload no longer offers. They stay as chips, so the user sees why Next is disabled.
  const goneClusters = placementClustersLoaded ? clusterNames.filter((name) => !placementClusters.includes(name)) : [];
  // Like the text fields, Clusters shows its error only once the user has changed it.
  const [clusterNamesTouched, setClusterNamesTouched] = useState(false);
  const { data: nameDescData, onDataChange: onNameDescChange } = useK8sNameDescriptionFieldData({
    maxLength: 63,
    // A k8sName makes the resource name read-only, as a deployed one is.
    initialData: model ? { name: titleOf(model), description: model.description ?? '', k8sName: model.id } : undefined,
  });
  const [modelUri, setModelUri] = useState(start.modelUri);
  const [replicas, setReplicas] = useState(start.replicas);
  // The hardware a new model runs on: the first in the console's list until the user selects
  // another. A deployed model keeps its own, read-only.
  const [hardwareId, setHardwareId] = useState<string>();
  const hardware = editing ? undefined : (hardwareList.find((h) => h.id === hardwareId) ?? hardwareList[0]);
  const accelerator = hardware?.accelerator;
  // The fields the hardware fills in hold undefined until the user edits them, so they show the
  // selected hardware's value. An edited CPU, memory or accelerator count is kept when the hardware
  // changes; the image is the hardware's, so selecting hardware replaces an edited one with its own
  // (or none, for the cluster's default).
  const [imageInput, setRuntimeImage] = useState<string | undefined>(model ? (model.runtimeImage ?? '') : undefined);
  const selectHardware = (id: string) => {
    setHardwareId(id);
    setRuntimeImage(undefined);
  };
  const [cpuInput, setCpu] = useState<string>();
  const [memoryInput, setMemory] = useState<string>();
  const [acceleratorsInput, setAccelerators] = useState<string>();
  const runtimeImage = imageInput ?? hardware?.image ?? '';
  const cpu = model ? (model.cpu ?? '') : (cpuInput ?? hardware?.defaults?.cpu ?? defaults.cpu);
  const memory = model ? (model.memory ?? '') : (memoryInput ?? hardware?.defaults?.memory ?? defaults.memory);
  const accelerators = acceleratorsInput ?? String(hardware?.defaults?.accelerators ?? defaults.accelerators);
  const [runtimeArgs, setRuntimeArgs] = useState<RuntimeArgsFieldData>({
    enabled: start.runtimeArgs.length > 0,
    args: start.runtimeArgs,
  });
  // A field shows its error only once the user has left it, as Clusters does.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = (field: string) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const input: ModelInput = {
    name: nameDescData.k8sName.value,
    displayName: nameDescData.name,
    description: nameDescData.description,
    modelUri: modelUri.trim(),
    runtimeImage,
    replicas: Number(replicas),
    cpu,
    memory,
    accelerator,
    // Hardware without an accelerator asks for none.
    acceleratorCount: accelerator ? Number(accelerators) : 0,
    env: hardwareEnv(hardware),
    runtimeArgs: filterRuntimeArgsForContainer(runtimeArgs.args),
    clusters: clusterNames,
  };
  const edited: ModelInput = { ...input, clusters: clustersEditable ? clusterNames : start.clusterNames };
  const isDirty = model
    ? updateRequestOf(model, edited) !== undefined
    : [modelUri, nameDescData.name, nameDescData.description].some((v) => v !== '') ||
      [imageInput, cpuInput, memoryInput, acceleratorsInput].some((v) => v !== undefined) ||
      (hardwareId !== undefined && hardwareId !== hardwareList[0]?.id) ||
      replicas !== defaults.replicas ||
      runtimeArgs.enabled ||
      clusterNames.length > 0;
  const detailsPath = model ? modelPath(model) : '';
  const leave = () => navigate(model ? detailsPath : '/models');
  const [requestLeave, discardModal] = useConfirmDiscard(isDirty && !saving, leave);

  // Every field this checks is required, so a field the user left empty says so.
  const shownError = (field: keyof typeof createModelSchema.shape, value: string, parse?: (text: string) => unknown) =>
    !touched.has(field)
      ? undefined
      : value.trim()
        ? fieldMessage(createModelSchema.shape[field], value, parse)
        : 'Required.';
  const modelUriError = shownError('modelUri', modelUri);
  // The image may be empty: the cluster's default.
  const runtimeImageError = touched.has('runtimeImage')
    ? fieldMessage(createModelSchema.shape.runtimeImage, runtimeImage)
    : undefined;
  const replicasError = shownError('replicas', replicas, Number);
  const cpuError = shownError('cpu', cpu);
  const memoryError = shownError('memory', memory);
  // Hardware with an accelerator needs at least one: without it the model can't use the hardware.
  const acceleratorsValid =
    /^\d+$/.test(accelerators) && Number(accelerators) >= 1 && Number(accelerators) <= MAX_ACCELERATORS;
  const acceleratorsError = !touched.has('accelerators')
    ? undefined
    : accelerators === ''
      ? 'Required.'
      : acceleratorsValid
        ? undefined
        : `Enter a number from 1 to ${MAX_ACCELERATORS}.`;
  // A deployed model's source, name and resources are fixed, so only what an edit can change is checked.
  const sourceValid = editing || createModelSchema.pick({ modelUri: true }).safeParse({ modelUri }).success;
  const deploymentValid = editing
    ? createModelSchema
        .pick({ displayName: true, description: true })
        .safeParse({ displayName: input.displayName, description: input.description }).success &&
      createModelSchema.shape.runtimeImage.safeParse(input.runtimeImage).success &&
      // The deploy wizard's limits apply to a count the user sets, not to one the model already has.
      (!replicasEditable ||
        replicas === start.replicas ||
        (replicas !== '' && createModelSchema.shape.replicas.safeParse(input.replicas).success))
    : hardware !== undefined &&
      replicas !== '' &&
      (!accelerator || acceleratorsValid) &&
      createModelSchema.omit({ locations: true }).strip().safeParse(input).success;
  // An edit that keeps its clusters doesn't depend on which clusters are offered right now.
  const clusterNamesChanged = !editing || !sameSet(clusterNames, start.clusterNames);
  const clusterNamesValid =
    !clustersEditable ||
    (!clusterNamesChanged && clusterNames.length > 0) ||
    (placementClustersLoaded &&
      !reloadingPlacementClusters &&
      !placementClustersError &&
      clusterNames.length > 0 &&
      goneClusters.length === 0);
  const isStepValid = (step: string) =>
    step === steps.source
      ? sourceValid
      : sourceValid &&
        deploymentValid &&
        (step === steps.deployment || clusterNamesValid) &&
        // Saving an edit that changes nothing would only bump the version.
        (step !== steps.review || !editing || isDirty);

  const save = async () => {
    if (saving || !sourceValid || !deploymentValid || !clusterNamesValid || (editing && !isDirty)) return;
    setSaving(true);
    setError(undefined);
    try {
      if (model) {
        await writes.updateModel(model, edited);
        navigate(detailsPath, { state: { notice: 'Model updated' } });
      } else {
        await writes.createModel(input);
        // Replaces the deploy form in history, so Back doesn't land on it, empty.
        navigate('/models', { replace: true, state: { notice: 'Model deployed' } });
      }
    } catch (err) {
      setError(
        notAvailable(err, editing ? 'Editing models is' : 'Deploying models is') ??
          (editing && err instanceof ServiceError && err.status === 409
            ? 'This model was changed by another user. Reload the page to edit the latest version.'
            : err instanceof Error
              ? err.message
              : editing
                ? 'Unable to update the model.'
                : 'Unable to deploy the model.'),
      );
      setSaving(false);
    }
  };

  // A placement the console doesn't edit, or none, as the review and the step show it.
  const placedAt = () => {
    if (!model?.placed) return 'Not deployed to a cluster';
    return model.selectedClusters.length > 0 ? model.selectedClusters.join(', ') : 'No clusters selected';
  };

  const clustersStep = () => {
    if (!clustersEditable) {
      return (
        <ReadOnlyField
          label="Clusters"
          fieldId="model-clusters"
          value={placedAt()}
          reason={
            model?.placed
              ? "This model's placement selects clusters by more than their names, so its clusters cannot be edited here."
              : 'This model is not deployed to any AI Grid cluster.'
          }
        />
      );
    }
    if (placementClustersError) {
      return (
        <Alert
          isInline
          variant="danger"
          title="Unable to load clusters"
          actionLinks={<AlertActionLink onClick={() => void reloadPlacementClusters()}>Retry</AlertActionLink>}
        >
          {notAvailable(placementClustersError, 'Clusters are') ?? placementClustersError.message}
        </Alert>
      );
    }
    if (!placementClustersLoaded) {
      return <Spinner size="lg" aria-label="Loading clusters" />;
    }
    // With chosen clusters to show, the field stays, so the user can see and remove them.
    if (placementClusters.length === 0 && goneClusters.length === 0) {
      return (
        <Alert isInline variant="warning" title="No clusters available">
          A cluster appears here when it is an AI Grid cluster that serves models, and is Ready and Provisioned.
        </Alert>
      );
    }
    return (
      <FormGroup label="Clusters" fieldId="model-clusters" isRequired>
        <MultiSelection
          id="model-clusters-select"
          inputId="model-clusters"
          ariaLabel="Clusters"
          placeholder="Select clusters"
          selectionRequired={clusterNamesTouched}
          noSelectedOptionsMessage="Select at least one cluster."
          errorMessage={clusterNamesChanged ? goneClustersError(goneClusters) : undefined}
          value={[
            ...placementClusters.map((name) => ({
              id: name,
              name,
              description: clusterDescriptions.get(name),
              selected: clusterNames.includes(name),
            })),
            ...goneClusters.map((name) => ({
              id: name,
              name,
              selected: true,
              chipOnly: true,
            })),
          ]}
          setValue={(options) => {
            setClusterNamesTouched(true);
            setClusterNames(options.filter((option) => option.selected).map((o) => String(o.id)));
          }}
          isDisabled={saving}
        />
        <Help>
          The model runs on each selected AI Grid cluster.
          {unavailableMembers > 0 &&
            ` ${unavailableMembers} AI Grid ${unavailableMembers === 1 ? 'cluster is' : 'clusters are'} not listed because ${unavailableMembers === 1 ? 'it is' : 'they are'} not Ready and Provisioned, or ${unavailableMembers === 1 ? 'does' : 'do'} not serve models.`}
        </Help>
      </FormGroup>
    );
  };

  // The Hardware choice of a new model, from the console's config, which App loads once.
  const hardwareField = () => {
    if (!config && configError) {
      return (
        <Alert
          isInline
          variant="danger"
          title="Unable to load hardware"
          actionLinks={reloadConfig && <AlertActionLink onClick={() => void reloadConfig()}>Retry</AlertActionLink>}
        >
          {configError.message}
        </Alert>
      );
    }
    if (!config) {
      return <Spinner size="lg" aria-label="Loading hardware" />;
    }
    return (
      <FormGroup role="radiogroup" isStack fieldId="model-hardware" label="Hardware">
        {hardwareList.map((h) => (
          <Radio
            key={h.id}
            id={`model-hardware-${h.id}`}
            name="model-hardware"
            label={h.label}
            description={h.description}
            isChecked={h.id === hardware?.id}
            onChange={() => selectHardware(h.id)}
            isDisabled={saving}
          />
        ))}
      </FormGroup>
    );
  };

  // A hint only, from the GPU counts the clusters list carries, which count NVIDIA GPUs only (the
  // backend reads them from NVIDIA's GPU discovery): NVIDIA hardware on a cluster with none never
  // schedules, and CPU-only hardware on a GPU cluster leaves its GPUs unused. Other accelerators
  // get no hint.
  const hardwareMismatch = (() => {
    if (editing || !hardware || (accelerator && accelerator !== NVIDIA_GPU)) return undefined;
    // The chosen ids are cluster names, never `location` labels.
    const chosen = clusters.filter((c) => c.aiGridEnabled && clusterNames.includes(c.name));
    const mismatched = chosen
      .filter((c) => c.gpuCapacity !== undefined && (accelerator ? c.gpuCapacity === 0 : c.gpuCapacity > 0))
      .map((c) => c.name)
      .sort();
    if (mismatched.length === 0) return undefined;
    const names = mismatched.join(', ');
    const one = mismatched.length === 1;
    return accelerator
      ? `${names} ${one ? 'reports' : 'report'} no NVIDIA GPUs, so the model can't run there`
      : `${names} ${one ? 'has' : 'have'} GPUs that the model doesn't use with ${hardware.label}`;
  })();

  const presets = model?.baseRefs.join(', ');
  const hardwareItem: ReviewItem = model
    ? presets
      ? { term: 'Presets', value: presets }
      : { term: 'Hardware', value: hardwareText(model, hardwareList) }
    : { term: 'Hardware', value: hardware?.label };
  const acceleratorItems: ReviewItem[] = model
    ? model.acceleratorRequests.map((r) => ({ term: acceleratorLabel(r.resource), value: r.count }))
    : accelerator
      ? [{ term: acceleratorLabel(accelerator), value: accelerators }]
      : [];
  const review = [
    {
      title: 'Source',
      step: steps.source,
      items: [
        { term: 'Model URI', value: modelUri },
        // A deployed model keeps the name it is served as; a new one is served as its resource name.
        ...(model ? [{ term: 'Model name in requests', value: model.modelName ?? model.id }] : []),
      ],
    },
    {
      title: 'Deployment',
      step: steps.deployment,
      items: [
        { term: 'Model name', value: nameDescData.name },
        ...(model ? [] : [{ term: 'Model name in requests', value: nameDescData.k8sName.value }]),
        { term: 'Description', value: nameDescData.description },
        hardwareItem,
        // An empty image with presets runs theirs; without presets, the cluster's default.
        { term: 'Runtime image', value: runtimeImage.trim() || (presets ? undefined : DEFAULT_IMAGE) },
        { term: 'Replicas', value: replicasEditable ? replicas : 'Autoscaled' },
        { term: 'CPU', value: cpu },
        { term: 'Memory', value: memory },
        ...acceleratorItems,
        { term: 'Additional runtime arguments', value: input.runtimeArgs.join(' ') },
      ],
    },
    {
      title: 'Clusters',
      step: steps.clusters,
      items: [
        {
          term: 'Clusters',
          value: clustersEditable ? clusterNames.join(', ') : placedAt(),
        },
      ],
    },
  ];

  return (
    <>
      <PageHeader
        title={model ? `Edit ${titleOf(model)}` : 'Deploy model'}
        description={model ? "Edit the model's settings and clusters." : 'Deploy a model to AI Grid clusters.'}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/models">Models</Link>
            </BreadcrumbItem>
            {model && (
              <BreadcrumbItem>
                <Link to={detailsPath}>{titleOf(model)}</Link>
              </BreadcrumbItem>
            )}
            <BreadcrumbItem isActive>{model ? 'Edit' : 'Deploy model'}</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      <PageSection type="wizard" hasBodyWrapper={false} isFilled>
        <Wizard
          isProgressive={false}
          onClose={requestLeave}
          onStepChange={(_event, current, previous) => {
            // Start a new deployment's name from the model URI's last segment, once.
            if (!editing && previous.id === steps.source && !nameDescData.name) {
              onNameDescChange('name', deploymentNameFromUri(modelUri));
            }
            // A cluster can change state while the earlier steps are filled in, so offer what is available now.
            if (current.id === steps.clusters && clustersEditable) {
              const reload = ++reloadRef.current;
              setReloadingPlacementClusters(true);
              void reloadPlacementClusters().then(() => {
                if (reload === reloadRef.current) setReloadingPlacementClusters(false);
              });
              // The clusters only describe the options and count the unlisted members, so Next doesn't wait for them.
              void reloadClusters();
            }
          }}
          footer={
            <ConsoleWizardFooter
              submitStepId={steps.review}
              submitLabel={editing ? 'Save changes' : 'Deploy'}
              errorTitle={editing ? 'Unable to update model' : 'Unable to deploy model'}
              isStepValid={isStepValid}
              saving={saving}
              error={error}
              onSubmit={save}
              onCancel={requestLeave}
            />
          }
        >
          <WizardStep name="Source" id={steps.source}>
            <Form maxWidth="750px">
              {editing ? (
                <>
                  {model && <OlderServedNameAlert model={model} />}
                  <ReadOnlyField label="Model URI" fieldId="model-uri" value={modelUri} reason={fixedReason.source} />
                  <ReadOnlyField
                    label="Model name in requests"
                    fieldId="model-alias"
                    value={model?.modelName ?? model?.id ?? ''}
                    reason={fixedReason.served}
                  />
                </>
              ) : (
                <>
                  <FormGroup label="Model URI" fieldId="model-uri" isRequired>
                    <TextInput
                      id="model-uri"
                      aria-describedby="model-uri-help"
                      value={modelUri}
                      onChange={(_event, value) => setModelUri(value)}
                      onBlur={() => touch('modelUri')}
                      validated={modelUriError ? 'error' : 'default'}
                      isRequired
                    />
                    <Help id="model-uri-help" error={modelUriError}>
                      For example, hf://org/model, oci://registry/model:tag, s3://bucket/path, or pvc://claim/path.
                    </Help>
                  </FormGroup>
                </>
              )}
            </Form>
          </WizardStep>
          <WizardStep name="Deployment" id={steps.deployment} isDisabled={!sourceValid || saving}>
            <Form maxWidth="750px">
              <K8sNameDescriptionField
                data={nameDescData}
                onDataChange={onNameDescChange}
                dataTestId="model-name-desc"
                nameLabel="Model name"
                nameHelperText={
                  editing
                    ? undefined
                    : 'Users send the resource name as the model in their requests. Up to 63 characters.'
                }
              />
              {!model ? (
                hardwareField()
              ) : presets ? (
                <ReadOnlyField label="Presets" fieldId="model-presets" value={presets} reason={fixedReason.presets} />
              ) : (
                <ReadOnlyField
                  label="Hardware"
                  fieldId="model-hardware"
                  value={hardwareText(model, hardwareList) ?? ''}
                  reason={fixedReason.hardware}
                />
              )}
              <FormGroup label="Runtime image" fieldId="runtime-image">
                <TextInput
                  id="runtime-image"
                  aria-describedby="runtime-image-help"
                  value={runtimeImage}
                  onChange={(_event, value) => setRuntimeImage(value)}
                  onBlur={() => touch('runtimeImage')}
                  validated={runtimeImageError ? 'error' : 'default'}
                />
                <Help id="runtime-image-help" error={runtimeImageError}>
                  {!model
                    ? runtimeImageHelp(hardware)
                    : presets
                      ? 'Leave empty to use the image the presets set.'
                      : runtimeImageHelp(undefined)}
                </Help>
              </FormGroup>
              {replicasEditable ? (
                <FormGroup label="Replicas" fieldId="deployment-replicas" isRequired>
                  <CountInput
                    id="deployment-replicas"
                    label="Replicas"
                    min={1}
                    max={99}
                    value={replicas}
                    onChange={setReplicas}
                    onBlur={() => touch('replicas')}
                    describedBy="deployment-replicas-help"
                    validated={replicasError ? 'error' : 'default'}
                  />
                  <Help id="deployment-replicas-help" error={replicasError}>
                    From 1 to 99.
                  </Help>
                </FormGroup>
              ) : (
                <ReadOnlyField
                  label="Replicas"
                  fieldId="deployment-replicas"
                  value="Autoscaled"
                  reason="This model scales automatically, so it has no fixed replica count."
                />
              )}
              {model ? (
                <>
                  {/* A model deployed without requests has none to show. */}
                  <ReadOnlyField
                    label="CPU"
                    fieldId="deployment-cpu"
                    value={cpu || NOT_SET}
                    reason={fixedReason.resources}
                  />
                  <ReadOnlyField
                    label="Memory"
                    fieldId="deployment-memory"
                    value={memory || NOT_SET}
                    reason={fixedReason.resources}
                  />
                  {model.acceleratorRequests.map((r, i) => (
                    <ReadOnlyField
                      key={r.resource}
                      label={acceleratorLabel(r.resource)}
                      fieldId={`deployment-accelerators${i ? `-${i}` : ''}`}
                      value={r.count}
                      reason={fixedReason.resources}
                    />
                  ))}
                </>
              ) : (
                <>
                  <FormGroup label="CPU" fieldId="deployment-cpu" isRequired>
                    <TextInput
                      id="deployment-cpu"
                      aria-describedby="deployment-cpu-help"
                      value={cpu}
                      onChange={(_event, value) => setCpu(value)}
                      onBlur={() => touch('cpu')}
                      validated={cpuError ? 'error' : 'default'}
                      isRequired
                    />
                    <Help id="deployment-cpu-help" error={cpuError}>
                      In cores or millicores. For example, 2 or 500m.
                    </Help>
                  </FormGroup>
                  <FormGroup label="Memory" fieldId="deployment-memory" isRequired>
                    <TextInput
                      id="deployment-memory"
                      aria-describedby="deployment-memory-help"
                      value={memory}
                      onChange={(_event, value) => setMemory(value)}
                      onBlur={() => touch('memory')}
                      validated={memoryError ? 'error' : 'default'}
                      isRequired
                    />
                    <Help id="deployment-memory-help" error={memoryError}>
                      For example, 4Gi or 512Mi.
                    </Help>
                  </FormGroup>
                  {accelerator && (
                    <FormGroup label={acceleratorLabel(accelerator)} fieldId="deployment-accelerators" isRequired>
                      <CountInput
                        id="deployment-accelerators"
                        label={acceleratorLabel(accelerator)}
                        min={1}
                        max={MAX_ACCELERATORS}
                        value={accelerators}
                        onChange={setAccelerators}
                        onBlur={() => touch('accelerators')}
                        describedBy="deployment-accelerators-help"
                        validated={acceleratorsError ? 'error' : 'default'}
                      />
                      <Help id="deployment-accelerators-help" error={acceleratorsError}>
                        From 1 to {MAX_ACCELERATORS}.
                      </Help>
                    </FormGroup>
                  )}
                </>
              )}
              <ExpandableSection toggleText="Advanced settings" isIndented>
                <RuntimeArgsField data={runtimeArgs} onChange={setRuntimeArgs} />
              </ExpandableSection>
            </Form>
          </WizardStep>
          <WizardStep name="Clusters" id={steps.clusters} isDisabled={!sourceValid || !deploymentValid || saving}>
            <Form maxWidth="750px">{clustersStep()}</Form>
          </WizardStep>
          <WizardStep
            name="Review"
            id={steps.review}
            isDisabled={!sourceValid || !deploymentValid || !clusterNamesValid || saving}
          >
            <ReviewStep
              sections={review}
              alert={
                model ? (
                  <OlderServedNameAlert model={model} />
                ) : (
                  hardwareMismatch && (
                    <Alert isInline variant="warning" title={hardwareMismatch} data-testid="model-hardware-mismatch" />
                  )
                )
              }
            />
          </WizardStep>
        </Wizard>
      </PageSection>
      {discardModal}
    </>
  );
};
