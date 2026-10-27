import { createRouterTransport, type Interceptor, type ServiceImpl, type Transport } from '@connectrpc/connect';
import { AiGrid, Clusters, createConsoleClients, Tenants, Models, Subscriptions, type ConsoleClients } from './clients';

/**
 * The methods a test implements, per service. A method left out answers Unimplemented, as an RPC
 * the backend doesn't have yet does: a page shows it as not available.
 */
export type FakeBackend = {
  aiGrid?: Partial<ServiceImpl<typeof AiGrid>>;
  clusters?: Partial<ServiceImpl<typeof Clusters>>;
  tenants?: Partial<ServiceImpl<typeof Tenants>>;
  models?: Partial<ServiceImpl<typeof Models>>;
  subscriptions?: Partial<ServiceImpl<typeof Subscriptions>>;
};

/**
 * Typed clients over an in-memory backend (createRouterTransport): requests and answers go through
 * the same serialization as over the wire, with no server and no fetch. `interceptors` runs on the
 * client side, so a test can check the console's own (sessionCheck) against a fake's errors.
 */
export const fakeClients = (
  backend: FakeBackend,
  { interceptors = [] }: { interceptors?: Interceptor[] } = {},
): { transport: Transport; clients: ConsoleClients } => {
  const transport = createRouterTransport(
    ({ service }) => {
      service(AiGrid, backend.aiGrid ?? {});
      service(Clusters, backend.clusters ?? {});
      service(Tenants, backend.tenants ?? {});
      service(Models, backend.models ?? {});
      service(Subscriptions, backend.subscriptions ?? {});
    },
    { transport: { interceptors } },
  );
  return { transport, clients: createConsoleClients(transport) };
};
