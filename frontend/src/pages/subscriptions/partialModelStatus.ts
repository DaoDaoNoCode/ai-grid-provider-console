import type { ModelView } from '../models/modelView';

export const hasPartialModelStatus = (model: ModelView | undefined): model is ModelView =>
  model?.state === 'Partially ready' && model.clusters.length > 0;
