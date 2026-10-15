import { HttpConsoleService } from '../api/HttpConsoleService';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpConsoleService', () => {
  it('unwraps the data envelope', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { username: 'u', groups: [], isProviderAdmin: true } }));
    const service = new HttpConsoleService(fetchFn);
    await expect(service.getUser()).resolves.toEqual({ username: 'u', groups: [], isProviderAdmin: true });
    expect(fetchFn).toHaveBeenCalledWith('/api/v1/user', expect.objectContaining({ method: 'GET' }));
  });

  it('sends PATCH bodies as JSON and escapes names', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: { name: 'a/b' } }));
    const service = new HttpConsoleService(fetchFn);
    await service.updateCluster('a/b', { aiGridEnabled: true });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/clusters/a%2Fb',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ aiGridEnabled: true }) }),
    );
  });

  it('surfaces the BFF error message and status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: { code: '401', message: 'missing header' } }));
    const service = new HttpConsoleService(fetchFn);
    await expect(service.getUser()).rejects.toMatchObject({ status: 401, message: 'missing header' });
  });

  it('maps network failures to status 0', async () => {
    const service = new HttpConsoleService(vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(service.listClusters()).rejects.toMatchObject({ status: 0 });
  });
});
