// @vitest-environment jsdom
// jsdom: the transport posts to window.location's origin.
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createClient, type Interceptor, type StreamResponse } from '@connectrpc/connect';
import { Clusters } from '../../gen/ai_grid/v1/clusters_service_pb';
import { ManagedClusterSchema } from '../../gen/ai_grid/v1/managed_cluster_type_pb';
import { describeError } from './errors';
import { fakeClients } from './testing';
import { createConsoleTransport, sessionCheck } from './transport';

const failWith = (code: Code) => () => {
  throw new ConnectError('refused', code);
};

describe('sessionCheck', () => {
  it('checks the session on Unauthenticated and rethrows the same error', async () => {
    const checkSession = vi.fn();
    const { clients } = fakeClients(
      { clusters: { list: failWith(Code.Unauthenticated) } },
      { interceptors: [sessionCheck(checkSession)] },
    );
    const err = await clients.clusters.list({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.Unauthenticated);
    expect((err as ConnectError).rawMessage).toBe('refused');
    expect(checkSession).toHaveBeenCalledTimes(1);
  });

  it.each([Code.PermissionDenied, Code.NotFound, Code.Unavailable, Code.Unimplemented].map((c) => [Code[c], c]))(
    'leaves the session alone on %s',
    async (_name, code) => {
      const checkSession = vi.fn();
      const { clients } = fakeClients(
        { clusters: { list: failWith(code) } },
        { interceptors: [sessionCheck(checkSession)] },
      );
      await expect(clients.clusters.list({})).rejects.toMatchObject({ code });
      expect(checkSession).not.toHaveBeenCalled();
    },
  );

  it('leaves the session alone on success', async () => {
    const checkSession = vi.fn();
    const { clients } = fakeClients(
      { clusters: { get: () => ({ object: create(ManagedClusterSchema, { id: 'site-paris-1' }) }) } },
      { interceptors: [sessionCheck(checkSession)] },
    );
    const res = await clients.clusters.get({ id: 'site-paris-1' });
    expect(res.object?.id).toBe('site-paris-1');
    expect(checkSession).not.toHaveBeenCalled();
  });

  it('checks the session when a server stream fails after its headers', async () => {
    const checkSession = vi.fn();
    const failing = (async function* () {
      yield { n: 1 };
      throw new ConnectError('token expired mid-stream', Code.Unauthenticated);
    })();
    const next = (async () =>
      ({ stream: true, message: failing }) as unknown as StreamResponse) as unknown as Parameters<Interceptor>[0];
    const res = (await sessionCheck(checkSession)(next)({} as never)) as StreamResponse;
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const m of res.message) {
          seen.push(m);
        }
      })(),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
    expect(seen).toEqual([{ n: 1 }]);
    expect(checkSession).toHaveBeenCalledTimes(1);
  });
});

describe('createConsoleTransport', () => {
  const answer = (status: number, body: unknown) =>
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );

  it('posts Connect JSON to the console origin under /ai_grid.v1.', async () => {
    const fetchFn = answer(200, { size: 0, total: 0, items: [] });
    const client = createClient(Clusters, createConsoleTransport({ fetch: fetchFn }));
    const res = await client.list({ limit: 5 });
    expect(res.total).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${window.location.origin}/ai_grid.v1.Clusters/List`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(init?.body as Uint8Array))).toEqual({ limit: 5 });
  });

  // The BFF's own 401 is a Connect error. kube-auth-proxy's, on an --api-route path without a
  // valid session, is not: oauth2-proxy's errorJSON writes application/json `{}`, and its error
  // page, or a proxy in front, plain text. Each still reads as Unauthenticated.
  it.each([
    ['the BFF', 'application/json', JSON.stringify({ code: 'unauthenticated', message: 'missing token' })],
    ["kube-auth-proxy's JSON", 'application/json', '{}'],
    ["kube-auth-proxy's JSON with an error", 'application/json', JSON.stringify({ error: 'Unauthorized' })],
    ['a plain-text 401', 'text/plain; charset=utf-8', 'Unauthorized\n'],
    ['an empty 401', '', ''],
  ])('checks the session on a 401 from %s', async (_from, contentType, body) => {
    const checkSession = vi.fn();
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 401, headers: contentType ? { 'Content-Type': contentType } : {} }),
    );
    const client = createClient(Clusters, createConsoleTransport({ checkSession, fetch: fetchFn }));
    const err = await client.list({}).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: Code.Unauthenticated });
    expect(describeError(err)).toMatchObject({ kind: 'unauthenticated' });
    expect(checkSession).toHaveBeenCalledTimes(1);
  });

  it('checks nothing without a session check', async () => {
    const client = createClient(Clusters, createConsoleTransport({ fetch: answer(401, { code: 'unauthenticated' }) }));
    await expect(client.list({})).rejects.toMatchObject({ code: Code.Unauthenticated });
  });

  it("does not check the session on the provider-admin gate's 403", async () => {
    const checkSession = vi.fn();
    const fetchFn = answer(403, { code: 'permission_denied', message: 'this console is only for provider admins' });
    const client = createClient(Clusters, createConsoleTransport({ checkSession, fetch: fetchFn }));
    await expect(client.list({})).rejects.toMatchObject({
      code: Code.PermissionDenied,
      rawMessage: 'this console is only for provider admins',
    });
    expect(checkSession).not.toHaveBeenCalled();
  });
});
