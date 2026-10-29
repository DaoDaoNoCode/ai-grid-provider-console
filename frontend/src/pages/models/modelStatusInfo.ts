import type { ModelView } from './modelView';

/**
 * What KServe's terminal Ready=False reasons (ConfigNotFound, RefsInvalid, GatewaysNotReady) mean to
 * an administrator, and what to do next. The backend reports them as the model's reason when it reads
 * a live LLMInferenceService (model_mapper.go); in git mode the reasons are its own.
 */
export const failureExplanations: Record<string, { summary: string; next: string }> = {
  ConfigNotFound: {
    summary: 'A runtime template this model needs isn’t installed on the hub.',
    next: 'Install the template on the hub, or deploy the model with another runtime.',
  },
  RefsInvalid: {
    summary: 'The model refers to a resource that doesn’t exist or isn’t valid.',
    next: 'Check the model URI and the runtime, then deploy the model again.',
  },
  GatewaysNotReady: {
    summary: 'The gateway that serves this model isn’t ready.',
    next: 'Check the AI Grid gateway on the hub.',
  },
};

export const modelPhase = (model: Pick<ModelView, 'phase'>): string => model.phase;

/** A placed model serving on some of its clusters but not all (the backend's phase, proposal P13). */
export const PARTIALLY_AVAILABLE = 'Partially available';

/** The status's title: "Deployment failed" for Failed, else the phase. */
export const modelStatusTitle = (model: ModelView): string =>
  modelPhase(model) === 'Failed' ? 'Deployment failed' : modelPhase(model);

/** Whether the model has anything to explain beyond its phase. */
export const hasModelStatusDetails = (model: ModelView): boolean => !!(model.reason || model.statusMessage);
