import { test, expect } from '@playwright/test';
import configExample from '../../mock/examples/get-config.json' with { type: 'json' };
import userExample from '../../mock/examples/get-user.json' with { type: 'json' };

const datasource = {
  kind: 'Datasource',
  metadata: { name: 'prometheus', project: 'ai-grid' },
  spec: { default: true, plugin: { kind: 'PrometheusDatasource', spec: {} } },
};
const query = {
  kind: 'TimeSeriesQuery',
  spec: { plugin: { kind: 'PrometheusTimeSeriesQuery', spec: { query: 'compat_metric{cluster="$cluster"}' } } },
};
const dashboard = (name: string, title: string) => ({
  kind: 'Dashboard',
  metadata: { name, project: 'ai-grid' },
  spec: {
    display: { name: title },
    duration: '1h',
    refreshInterval: '0s',
    variables: [
      {
        kind: 'ListVariable',
        spec: {
          name: 'cluster',
          display: { name: 'Cluster' },
          allowMultiple: false,
          allowAllValue: false,
          defaultValue: 'site-a',
          plugin: { kind: 'PrometheusLabelValuesVariable', spec: { labelName: 'cluster' } },
        },
      },
    ],
    panels: {
      requests: {
        kind: 'Panel',
        spec: {
          display: { name: 'Requests' },
          plugin: {
            kind: 'StatChart',
            spec: { calculation: 'last-number', format: { unit: 'decimal' }, legendMode: 'off' },
          },
          queries: [query],
        },
      },
      latency: {
        kind: 'Panel',
        spec: { display: { name: 'Latency' }, plugin: { kind: 'TimeSeriesChart', spec: {} }, queries: [query] },
      },
    },
    layouts: [
      {
        kind: 'Grid',
        spec: {
          items: [
            { x: 0, y: 0, width: 8, height: 4, content: { $ref: '#/spec/panels/requests' } },
            { x: 8, y: 0, width: 16, height: 4, content: { $ref: '#/spec/panels/latency' } },
          ],
        },
      },
    ],
  },
});
const dashboards = [dashboard('dashboard-1-fleet', 'Fleet health'), dashboard('dashboard-2-usage', 'Token usage')];

test('real Perses panels remain compatible with the shared Query runtime', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  const queries: { query: string; start: string; end: string }[] = [];
  let userReads = 0;
  let responseStatus = 200;
  page.on('pageerror', (error) => errors.push('Uncaught: ' + error.message));
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      !/Failed to load resource:.*(?:401|500)/.test(msg.text()) &&
      !msg.text().includes('Compatibility test injected failure')
    ) {
      errors.push(msg.text());
    }
  });
  const config = structuredClone(configExample.body);
  config.data.monitoring = { enabled: true, persesProject: 'ai-grid' };
  config.data.fakeBackend = true;
  const user = userExample.body;
  await page.route('**/api/v1/user', (route) => {
    userReads++;
    return route.fulfill({ json: user });
  });
  await page.route('**/api/v1/config', (route) => route.fulfill({ json: config }));
  await page.route('**/perses/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/dashboards')) return route.fulfill({ json: dashboards });
    if (url.pathname.includes('/api/v1/projects/ai-grid/datasources')) return route.fulfill({ json: [datasource] });
    if (url.pathname.includes('/api/v1/globaldatasources')) return route.fulfill({ json: [] });
    if (url.pathname.includes('/label/cluster/values'))
      return route.fulfill({ json: { status: 'success', data: ['site-a', 'site-b'] } });
    if (url.pathname.endsWith('/api/v1/query_range') || url.pathname.endsWith('/api/v1/query')) {
      const params = request.method() === 'POST' ? new URLSearchParams(request.postData() || '') : url.searchParams;
      queries.push({
        query: params.get('query') ?? '',
        start: params.get('start') ?? '',
        end: params.get('end') ?? '',
      });
      if (responseStatus !== 200)
        return route.fulfill({
          status: responseStatus,
          json: { status: 'error', errorType: 'server_error', error: 'Compatibility test injected failure' },
        });
      const start = Number(params.get('start')) || Date.now() / 1000 - 3600;
      const end = Number(params.get('end')) || Date.now() / 1000;
      const selected = (params.get('query') || '').includes('site-b') ? 'site-b' : 'site-a';
      const result = {
        metric: { __name__: 'compat_metric', cluster: selected },
        values: Array.from({ length: 10 }, (_, i) => [
          start + ((end - start) * i) / 9,
          String((selected === 'site-b' ? 72 : 42) + i),
        ]),
      };
      return route.fulfill({ json: { status: 'success', data: { resultType: 'matrix', result: [result] } } });
    }
    errors.push(`Unhandled fixture: ${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { message: 'No fixture' } });
  });
  await page.goto('/monitoring');
  await expect(page.getByRole('tab', { name: 'Fleet health' })).toBeVisible();
  await expect.poll(() => queries.length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect(page.getByText('Requests', { exact: true })).toBeVisible();
  await expect(page.getByText('Latency', { exact: true })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Cluster', exact: true }).click();
  await page.getByRole('option', { name: 'site-b', exact: true }).click();
  await expect.poll(() => queries.some((q) => q.query.includes('site-b'))).toBe(true);
  await expect(page.getByText('81', { exact: true })).toBeVisible();
  let before = queries.length;
  await page.getByRole('combobox', { name: /Select time range/ }).click();
  await page.getByRole('option', { name: 'Last 6 hours', exact: true }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  await expect
    .poll(() => Math.round(Number(queries[queries.length - 1].end) - Number(queries[queries.length - 1].start)))
    .toBe(21600);
  before = queries.length;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  await page.getByRole('tab', { name: 'Token usage', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Token usage', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Fleet health', exact: true }).click();
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/pf-v6-theme-dark/);
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.goto('/monitoring?refresh=1s');
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  before = queries.length;
  await expect.poll(() => queries.length, { timeout: 5000 }).toBeGreaterThan(before);
  await page.goto('/monitoring?refresh=0s');
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  const earlyErrors = errors.splice(0);
  expect(earlyErrors).toEqual([]);
  responseStatus = 500;
  before = queries.length;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect.poll(() => queries.length).toBeGreaterThan(before);
  await expect(page.getByText(/Compatibility test injected failure/).first()).toBeVisible();
  responseStatus = 200;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  await expect(page.getByText(/Compatibility test injected failure/)).toHaveCount(0);
  responseStatus = 401;
  const userBefore = userReads;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect.poll(() => userReads).toBeGreaterThan(userBefore);
  await expect(page.getByRole('tab', { name: 'Fleet health' })).toBeVisible();
  responseStatus = 200;
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByText('51', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
