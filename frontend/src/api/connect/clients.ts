import { createClient, type Client, type Transport } from '@connectrpc/connect';
import { AiGrid } from '../../gen/ai_grid/v1/ai_grid_service_pb';
import { Clusters } from '../../gen/ai_grid/v1/clusters_service_pb';
import { Tenants } from '../../gen/ai_grid/v1/tenants_service_pb';

/** Typed clients for the services of the backend's API at .backend-api-version (src/gen). */
export type ConsoleClients = {
  aiGrid: Client<typeof AiGrid>;
  clusters: Client<typeof Clusters>;
  tenants: Client<typeof Tenants>;
};

export const createConsoleClients = (transport: Transport): ConsoleClients => ({
  aiGrid: createClient(AiGrid, transport),
  clusters: createClient(Clusters, transport),
  tenants: createClient(Tenants, transport),
});

export { AiGrid, Clusters, Tenants };
