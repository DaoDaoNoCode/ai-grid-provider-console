import { create } from '@bufbuild/protobuf';
import { Code, type Interceptor } from '@connectrpc/connect';
import { ManagedClusterSchema } from '../../gen/ai_grid/v1/managed_cluster_type_pb';
import { fakeClients } from './testing';

describe('fakeClients', () => {
  it('serves the methods a test implements, with the request as sent', async () => {
    const seen: (number | undefined)[] = [];
    const { clients } = fakeClients({
      clusters: {
        list: (req) => {
          seen.push(req.limit);
          const items = [create(ManagedClusterSchema, { id: 'site-paris-1', status: { joined: true } })];
          return { size: items.length, total: items.length, items };
        },
      },
      aiGrid: { ping: (req) => ({ message: `hello ${req.name}` }) },
    });
    const list = await clients.clusters.list({ limit: 10 });
    expect(seen).toEqual([10]);
    expect(list.items.map((c) => [c.id, c.status?.joined])).toEqual([['site-paris-1', true]]);
    expect((await clients.aiGrid.ping({ name: 'console' })).message).toBe('hello console');
  });

  it('answers Unimplemented for a method or service the test leaves out', async () => {
    const { clients } = fakeClients({ clusters: { list: () => ({}) } });
    await expect(clients.clusters.get({ id: 'x' })).rejects.toMatchObject({ code: Code.Unimplemented });
    await expect(clients.tenants.list({})).rejects.toMatchObject({ code: Code.Unimplemented });
  });

  it('runs the given interceptors on every call', async () => {
    const methods: string[] = [];
    const record: Interceptor = (next) => (req) => {
      methods.push(`${req.service.typeName}/${req.method.name}`);
      return next(req);
    };
    const { clients } = fakeClients({ tenants: { list: () => ({}) } }, { interceptors: [record] });
    await clients.tenants.list({});
    expect(methods).toEqual(['ai_grid.v1.Tenants/List']);
  });
  it('provides Models and Subscriptions from the current backend pin', async () => {
    const { clients } = fakeClients({
      models: { list: () => ({ total: 1, items: [{ id: 'model-a' }] }) },
      subscriptions: { list: () => ({ total: 1, items: [{ id: 'subscription-a' }] }) },
    });
    expect((await clients.models.list({})).items[0].id).toBe('model-a');
    expect((await clients.subscriptions.list({})).items[0].id).toBe('subscription-a');
  });
});
