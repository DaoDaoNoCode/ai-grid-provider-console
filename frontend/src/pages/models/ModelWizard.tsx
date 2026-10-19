// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/models/ModelWizard.tsx at 62319b8.
// Adapted from packages/model-serving/src/components/deploymentWizard/ModelDeploymentWizard.tsx,
// steps/ModelSourceStep.tsx, steps/ModelDeploymentStep.tsx and steps/ReviewStep.tsx.
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// Standalone fields replace cluster catalogs and dynamic deployment plugins.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  ExpandableSection,
  Flex,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  PageSection,
  TextInput,
  Wizard,
  WizardStep,
  useWizardContext,
} from '@patternfly/react-core';
import type { UserService } from '../../api/ConsoleService';
import { ServiceError } from '../../api/ConsoleService';
import type { ClustersService } from '../../api/clusters';
import type { ModelsService } from '../../api/models';
import type { CreateModelRequest } from '../../api/types';
import { ConsoleWizardFooter } from '../../components/ConsoleWizardFooter';
import { CountInput } from '../../components/CountInput';
import { DetailsList } from '../../components/DetailsList';
import { DetailsSection } from '../../components/DetailsSection';
import { K8sNameDescriptionField } from '../../components/K8sNameDescriptionField/K8sNameDescriptionField';
import { useK8sNameDescriptionFieldData } from '../../components/K8sNameDescriptionField/useK8sNameDescriptionFieldData';
import { MultiSelection } from '../../components/MultiSelection';
import { PageHeader } from '../../components/PageHeader';
import { useConfirmDiscard } from '../../hooks/useConfirmDiscard';
import { useServiceData } from '../../hooks/useServiceData';
import { createModelSchema, fieldMessage } from '../../validation';
import { RuntimeArgsField } from './fields/RuntimeArgsField';
import { filterRuntimeArgsForContainer, type RuntimeArgsFieldData } from './fields/runtimeArgs';
import { locationLabel, siteNamesOf } from './modelUtils';

type Props = { service: ModelsService & UserService & Pick<ClustersService, 'listClusters'> };

const steps = {
  source: 'source-model-step',
  deployment: 'model-deployment-step',
  locations: 'locations-step',
  review: 'summary-step',
} as const;

const defaults = { replicas: '1', cpu: '2', memory: '4Gi', gpuCount: '0' };

/** A field's help line, replaced by the field's error while it has one. */
const Help: React.FC<{ children: React.ReactNode; error?: string; id?: string }> = ({ children, error, id }) => (
  <FormHelperText>
    <HelperText id={id}>
      <HelperTextItem variant={error ? 'error' : 'default'}>{error ?? children}</HelperTextItem>
    </HelperText>
  </FormHelperText>
);

const notAvailable = (err: unknown, what: string) =>
  err instanceof ServiceError && err.isNotImplemented ? `${what} not available on this backend yet.` : undefined;

/** "org/model" names a deployment "model": the last path segment, as a starting point. */
const deploymentNameFor = (modelName: string) => modelName.trim().split('/').filter(Boolean).pop() ?? '';

/** The Review step; each section's Edit link goes back to its step. */
const ReviewStep: React.FC<{
  sections: { title: string; step: string; items: { term: string; value?: string }[] }[];
}> = ({ sections }) => {
  const { goToStepById } = useWizardContext();
  return (
    <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsXl' }} data-testid="model-review">
      {sections.map((section) => (
        <DetailsSection key={section.title} title={section.title} onEdit={() => goToStepById(section.step)}>
          <DetailsList items={section.items} hideEmpty aria-label={section.title} />
        </DetailsSection>
      ))}
    </Flex>
  );
};

/** The four-step deploy wizard at /models/deploy: source, deployment, locations, review. */
export const ModelWizard: React.FC<Props> = ({ service }) => {
  const navigate = useNavigate();
  const [availableLocations, locationsLoaded, locationsError, reloadLocations] = useServiceData<string[]>(
    () => service.listLocations(),
    [],
    0,
  );
  const [clusters] = useServiceData(() => service.listClusters(), [], 0);
  const siteNames = useMemo(() => siteNamesOf(clusters), [clusters]);
  // AI Grid members whose location can't be chosen yet: not Ready, not provisioned, or unlabeled.
  const unavailableMembers = clusters.filter(
    (c) => c.aiGridEnabled && !(c.location && availableLocations.includes(c.location)),
  ).length;
  const [locations, setLocations] = useState<string[]>([]);
  // Like the text fields, Locations shows its error only once the user has changed it.
  const [locationsTouched, setLocationsTouched] = useState(false);
  const { data: nameDescData, onDataChange: onNameDescChange } = useK8sNameDescriptionFieldData({ maxLength: 63 });
  const [modelUri, setModelUri] = useState('');
  const [modelName, setModelName] = useState('');
  const [runtimeImage, setRuntimeImage] = useState('');
  const [replicas, setReplicas] = useState(defaults.replicas);
  const [cpu, setCpu] = useState(defaults.cpu);
  const [memory, setMemory] = useState(defaults.memory);
  const [gpuCount, setGpuCount] = useState(defaults.gpuCount);
  const [runtimeArgs, setRuntimeArgs] = useState<RuntimeArgsFieldData>({ enabled: false, args: [] });
  // A field shows its error only once the user has left it, as Locations does.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = (field: string) => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const input: CreateModelRequest = {
    name: nameDescData.k8sName.value,
    displayName: nameDescData.name,
    description: nameDescData.description,
    modelUri: modelUri.trim(),
    modelName,
    runtimeImage,
    replicas: Number(replicas),
    cpu,
    memory,
    gpuCount: Number(gpuCount),
    runtimeArgs: filterRuntimeArgsForContainer(runtimeArgs.args),
    locations,
  };
  const isDirty =
    [modelUri, modelName, runtimeImage, nameDescData.name, nameDescData.description].some((v) => v !== '') ||
    replicas !== defaults.replicas ||
    cpu !== defaults.cpu ||
    memory !== defaults.memory ||
    gpuCount !== defaults.gpuCount ||
    runtimeArgs.enabled ||
    locations.length > 0;
  const leave = () => navigate('/models');
  const [requestLeave, discardModal] = useConfirmDiscard(isDirty && !saving, leave);

  // Every field this checks is required, so a field the user left empty says so.
  const shownError = (field: keyof typeof createModelSchema.shape, value: string, parse?: (text: string) => unknown) =>
    !touched.has(field)
      ? undefined
      : value.trim()
        ? fieldMessage(createModelSchema.shape[field], value, parse)
        : 'Required.';
  const modelUriError = shownError('modelUri', modelUri);
  const modelNameError = shownError('modelName', modelName);
  const runtimeImageError = shownError('runtimeImage', runtimeImage);
  const replicasError = shownError('replicas', replicas, Number);
  const cpuError = shownError('cpu', cpu);
  const memoryError = shownError('memory', memory);
  const gpuCountError = shownError('gpuCount', gpuCount, Number);
  const sourceValid = createModelSchema
    .pick({ modelUri: true, modelName: true })
    .safeParse({ modelUri, modelName }).success;
  const deploymentValid =
    replicas !== '' && gpuCount !== '' && createModelSchema.omit({ locations: true }).strip().safeParse(input).success;
  const locationsValid =
    locationsLoaded &&
    !locationsError &&
    locations.length > 0 &&
    locations.every((location) => availableLocations.includes(location));
  const isStepValid = (step: string) =>
    step === steps.source
      ? sourceValid
      : sourceValid && deploymentValid && (step === steps.deployment || locationsValid);

  const save = async () => {
    if (saving || !sourceValid || !deploymentValid || !locationsValid) return;
    setSaving(true);
    setError(undefined);
    try {
      await service.createModel(input);
      navigate('/models', { state: { notice: 'Model deployed' } });
    } catch (err) {
      setError(
        notAvailable(err, 'Deploying models is') ??
          (err instanceof Error ? err.message : 'The model could not be deployed.'),
      );
      setSaving(false);
    }
  };

  const locationsStep = () => {
    if (locationsError) {
      return (
        <Alert isInline variant="danger" title="Error loading locations">
          {notAvailable(locationsError, 'Locations are') ?? locationsError.message}
          <Button variant="link" onClick={() => void reloadLocations()}>
            Retry
          </Button>
        </Alert>
      );
    }
    if (!locationsLoaded) {
      return <p>Loading locations...</p>;
    }
    if (availableLocations.length === 0) {
      return (
        <Alert isInline variant="warning" title="No locations available">
          Locations become available when an AI Grid member is provisioned and Ready.
        </Alert>
      );
    }
    return (
      <FormGroup label="Locations" fieldId="model-locations" isRequired>
        <MultiSelection
          id="model-locations-select"
          inputId="model-locations"
          ariaLabel="Locations"
          placeholder="Select locations"
          selectionRequired={locationsTouched}
          noSelectedOptionsMessage="Select at least one location."
          value={availableLocations.map((location) => ({
            id: location,
            name: locationLabel(location, siteNames),
            selected: locations.includes(location),
          }))}
          setValue={(options) => {
            setLocationsTouched(true);
            setLocations(options.filter((option) => option.selected).map((o) => String(o.id)));
          }}
          isDisabled={saving}
        />
        <Help>
          The model runs on the AI Grid clusters at each location you choose.
          {unavailableMembers > 0 &&
            ` ${unavailableMembers} AI Grid ${unavailableMembers === 1 ? 'cluster isn’t' : 'clusters aren’t'} listed because ${unavailableMembers === 1 ? 'it isn’t' : 'they aren’t'} Ready and provisioned with a location.`}
        </Help>
      </FormGroup>
    );
  };

  const review = [
    {
      title: 'Source',
      step: steps.source,
      items: [
        { term: 'Model URI', value: modelUri },
        { term: 'Model name', value: modelName },
      ],
    },
    {
      title: 'Deployment',
      step: steps.deployment,
      items: [
        { term: 'Deployment name', value: nameDescData.name },
        { term: 'Description', value: nameDescData.description },
        { term: 'Runtime image', value: runtimeImage },
        { term: 'Replicas', value: replicas },
        { term: 'CPU', value: cpu },
        { term: 'Memory', value: memory },
        { term: 'GPUs', value: gpuCount },
        { term: 'Additional runtime arguments', value: input.runtimeArgs.join(' ') },
      ],
    },
    {
      title: 'Locations',
      step: steps.locations,
      items: [{ term: 'Locations', value: locations.map((l) => locationLabel(l, siteNames)).join(', ') }],
    },
  ];

  return (
    <>
      <PageHeader
        title="Deploy model"
        description="Deploy a model to AI Grid locations."
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbItem>
              <Link to="/models">Models</Link>
            </BreadcrumbItem>
            <BreadcrumbItem isActive>Deploy model</BreadcrumbItem>
          </Breadcrumb>
        }
      />
      <PageSection hasBodyWrapper={false}>
        <Wizard
          className="portal-model-wizard"
          isProgressive={false}
          onClose={requestLeave}
          onStepChange={(_event, _current, previous) => {
            // Start the deployment's name from the model's, once.
            if (previous.id === steps.source && !nameDescData.name) {
              onNameDescChange('name', deploymentNameFor(modelName));
            }
          }}
          footer={
            <ConsoleWizardFooter
              submitStepId={steps.review}
              submitLabel="Deploy"
              errorTitle="Unable to deploy model"
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
                  Enter the model location, for example hf://org/model, oci://registry/model:tag, s3://bucket/path or
                  pvc://claim/path.
                </Help>
              </FormGroup>
              <FormGroup label="Model name" fieldId="model-alias" isRequired>
                <TextInput
                  id="model-alias"
                  aria-describedby="model-alias-help"
                  value={modelName}
                  onChange={(_event, value) => setModelName(value)}
                  onBlur={() => touch('modelName')}
                  validated={modelNameError ? 'error' : 'default'}
                  isRequired
                />
                <Help id="model-alias-help" error={modelNameError}>
                  The model name exposed by the inference service, for example org/model.
                </Help>
              </FormGroup>
            </Form>
          </WizardStep>
          <WizardStep name="Deployment" id={steps.deployment} isDisabled={!sourceValid || saving}>
            <Form maxWidth="750px">
              <K8sNameDescriptionField
                data={nameDescData}
                onDataChange={onNameDescChange}
                dataTestId="model-name-desc"
                nameLabel="Deployment name"
                nameHelperText="Choose a resource name of at most 63 characters."
              />
              <FormGroup label="Runtime image" fieldId="runtime-image" isRequired>
                <TextInput
                  id="runtime-image"
                  aria-describedby="runtime-image-help"
                  value={runtimeImage}
                  onChange={(_event, value) => setRuntimeImage(value)}
                  onBlur={() => touch('runtimeImage')}
                  validated={runtimeImageError ? 'error' : 'default'}
                  isRequired
                />
                <Help id="runtime-image-help" error={runtimeImageError}>
                  Container image for the serving runtime.
                </Help>
              </FormGroup>
              <FormGroup label="Replicas" fieldId="deployment-replicas" isRequired>
                <CountInput
                  id="deployment-replicas"
                  label="Replicas"
                  min={1}
                  max={99}
                  value={replicas}
                  onChange={setReplicas}
                  onBlur={() => touch('replicas')}
                  validated={replicasError ? 'error' : 'default'}
                />
                <Help error={replicasError}>Between 1 and 99.</Help>
              </FormGroup>
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
                  Positive cores or millicores, for example 2 or 500m.
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
                  For example 4Gi or 512Mi.
                </Help>
              </FormGroup>
              <FormGroup label="GPUs" fieldId="deployment-gpus" isRequired>
                <CountInput
                  id="deployment-gpus"
                  label="GPUs"
                  min={0}
                  max={64}
                  value={gpuCount}
                  onChange={setGpuCount}
                  onBlur={() => touch('gpuCount')}
                  validated={gpuCountError ? 'error' : 'default'}
                />
                <Help error={gpuCountError}>Between 0 and 64.</Help>
              </FormGroup>
              <ExpandableSection toggleText="Advanced settings" isIndented>
                <RuntimeArgsField data={runtimeArgs} onChange={setRuntimeArgs} />
              </ExpandableSection>
            </Form>
          </WizardStep>
          <WizardStep name="Locations" id={steps.locations} isDisabled={!sourceValid || !deploymentValid || saving}>
            <Form maxWidth="750px">{locationsStep()}</Form>
          </WizardStep>
          <WizardStep
            name="Review"
            id={steps.review}
            isDisabled={!sourceValid || !deploymentValid || !locationsValid || saving}
          >
            <ReviewStep sections={review} />
          </WizardStep>
        </Wizard>
      </PageSection>
      {discardModal}
    </>
  );
};
