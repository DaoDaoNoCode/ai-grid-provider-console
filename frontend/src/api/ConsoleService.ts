import type { ClusterUpdate, ConsoleConfig, GridCluster, User } from './types';

/**
 * Every page talks to the BFF through this interface only. The HTTP
 * implementation is used in the browser; tests use an in-memory one.
 */
export interface ConsoleService {
  getUser(): Promise<User>;
  getConfig(): Promise<ConsoleConfig>;
  listClusters(): Promise<GridCluster[]>;
  updateCluster(name: string, update: ClusterUpdate): Promise<GridCluster>;
  listLocations(): Promise<string[]>;
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
