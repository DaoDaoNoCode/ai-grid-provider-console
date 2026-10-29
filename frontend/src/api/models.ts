import type { ManagedModel } from './types';

/**
 * The models the Subscriptions pages read through the BFF's GET /api/v1/models, until they read the
 * backend's Models/List over Connect as the Models pages do (pages/models/useModels.ts).
 */
export interface ModelsService {
  listModels(): Promise<ManagedModel[]>;
}
