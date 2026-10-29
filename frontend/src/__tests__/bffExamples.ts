// The BFF's recorded example responses (mock/examples, written by bff/internal/examples), served
// to HttpConsoleService, so page
// tests render what the browser gets from `make dev-fake` instead of the mock's own shapes.
import getGridOverview from '../../../mock/examples/get-grid-overview.json';
import { HttpConsoleService } from '../api/HttpConsoleService';
import { MockConsoleService } from '../api/MockConsoleService';

const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });

/** Answers GET /models and /grid/overview with the BFF's example JSON. */
export const bffExamplesFetch = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.includes('/grid/overview')) {
      return json({ ...getGridOverview.body.data, metrics: [] });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 404 });
  });

/** A MockConsoleService whose models and grid overview come from the BFF's example JSON through HttpConsoleService. */
export const serviceOnBffExamples = (fetchFn: ReturnType<typeof bffExamplesFetch> = bffExamplesFetch()) => {
  const service = new MockConsoleService();
  const http = new HttpConsoleService(fetchFn as unknown as typeof fetch);
  service.getGridOverview = (...args) => http.getGridOverview(...args);
  return service;
};
