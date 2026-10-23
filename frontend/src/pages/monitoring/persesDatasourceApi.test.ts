import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelayDatasourceApi } from './persesDatasourceApi';

const api = new RelayDatasourceApi();

const datasource = (name: string, isDefault = false) => ({
  kind: 'Datasource',
  metadata: { name, project: 'p' },
  spec: { default: isDefault, plugin: { kind: 'PrometheusDatasource', spec: {} } },
});

/** Answers every fetch with `body` (a fresh Response each time) and records the URLs. */
const answer = (body: unknown, status = 200) => {
  const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
};

afterEach(() => vi.unstubAllGlobals());

describe('RelayDatasourceApi', () => {
  it("builds the relay's proxy paths, encoding each name", () => {
    expect(api.buildProxyUrl({ project: 'open-cluster-management-observability', name: 'thanos' })).toBe(
      '/perses/api/proxy/projects/open-cluster-management-observability/datasources/thanos',
    );
    expect(api.buildProxyUrl({ project: 'p', dashboard: 'd 1', name: 'a/b' })).toBe(
      '/perses/api/proxy/projects/p/dashboards/d%201/datasources/a%2Fb',
    );
    expect(api.buildProxyUrl({ name: 'global' })).toBe('/perses/api/proxy/globaldatasources/global');
  });

  it("finds a named datasource, or the project's default one of the kind", async () => {
    const fetchFn = answer([datasource('a'), datasource('b', true)]);
    expect((await api.getDatasource('p', { kind: 'PrometheusDatasource', name: 'a' }))?.metadata.name).toBe('a');
    expect((await api.getDatasource('p', { kind: 'PrometheusDatasource' }))?.metadata.name).toBe('b');
    expect(await api.getDatasource('p', { kind: 'PrometheusDatasource', name: 'missing' })).toBeUndefined();
    expect(fetchFn.mock.calls[0][0]).toBe('/perses/api/api/v1/projects/p/datasources?kind=PrometheusDatasource');
  });

  it('reads global datasources the same way', async () => {
    const fetchFn = answer([datasource('g', true)]);
    expect((await api.getGlobalDatasource({ kind: 'PrometheusDatasource' }))?.metadata.name).toBe('g');
    expect(fetchFn.mock.calls[0][0]).toBe('/perses/api/api/v1/globaldatasources?kind=PrometheusDatasource');
  });

  it('fails on an answer that is not 2xx', async () => {
    answer({ message: 'forbidden' }, 403);
    await expect(api.listDatasources('p')).rejects.toThrow('Perses answered 403');
  });
});
