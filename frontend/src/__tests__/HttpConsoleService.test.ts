import { HttpConsoleService } from '../api/HttpConsoleService';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpConsoleService', () => {
  it('unwraps the data envelope', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { username: 'u', groups: [], isProviderAdmin: true } }));
    const service = new HttpConsoleService(fetchFn);
    await expect(service.getUser()).resolves.toEqual({ username: 'u', groups: [], isProviderAdmin: true });
    expect(fetchFn).toHaveBeenCalledWith('/api/v1/user', expect.objectContaining({ method: 'GET' }));
  });

  it('maps the clusters the grid overview embeds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: { clusters: [{ name: 'site-madrid-1', aiGridEnabled: true, provisioned: true }], metrics: [] },
      }),
    );
    const overview = await new HttpConsoleService(fetchFn).getGridOverview('1h');
    expect(overview.clusters).toEqual([
      expect.objectContaining({ name: 'site-madrid-1', status: 'Unknown', provisioningStatus: 'Provisioned' }),
    ]);
  });

  it('surfaces the BFF error message and status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: '401', message: 'missing header' } }));
    const service = new HttpConsoleService(fetchFn);
    await expect(service.getUser()).rejects.toMatchObject({ status: 401, message: 'missing header' });
  });

  it('maps network failures to status 0', async () => {
    const service = new HttpConsoleService(vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(service.getUser()).rejects.toMatchObject({ status: 0 });
  });

  it('reads the grid overview with the range, site and metrics query', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse(200, { data: { clusters: [], metrics: [] } }));
    const service = new HttpConsoleService(fetchFn);
    await service.getGridOverview('1h');
    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/v1/grid/overview?range=1h',
      expect.objectContaining({ method: 'GET' }),
    );
    await service.getGridOverview('24h', { site: 'new york', includeMetrics: false });
    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/v1/grid/overview?range=24h&site=new+york&metrics=false',
      expect.objectContaining({ method: 'GET' }),
    );
    await service.getGridOverview('6h', { site: '', includeMetrics: true });
    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/v1/grid/overview?range=6h',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('carries field errors and flags conflicts', async () => {
    const body = {
      error: {
        code: '422',
        message: 'The request is invalid.',
        fieldErrors: { name: 'Use lowercase letters, numbers, and hyphens.' },
      },
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422 }));
    await expect(new HttpConsoleService(fetchFn).request('GET', '/grid/overview?range=1h')).rejects.toMatchObject({
      status: 422,
      fieldErrors: { name: 'Use lowercase letters, numbers, and hyphens.' },
      isConflict: false,
    });
    const conflict = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: '409', message: 'changed' } }), { status: 409 }));
    await expect(new HttpConsoleService(conflict).request('GET', '/grid/overview?range=1h')).rejects.toMatchObject({
      isConflict: true,
    });
  });
});
