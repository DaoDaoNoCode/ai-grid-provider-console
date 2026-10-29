import { expect, type APIRequestContext } from '@playwright/test';

// Setup and cleanup the browser specs do on the backend's own API, through the console's origin and
// the BFF's Connect relay, as the browser's client calls it. The specs assert on the pages, not on
// these calls.

/** One Connect unary call; fails the test unless the backend answers 200. */
export const callBackend = async <T>(request: APIRequestContext, procedure: string, body: unknown): Promise<T> => {
  const res = await request.post(`/ai_grid.v1.${procedure}`, {
    data: body,
    headers: { 'Connect-Protocol-Version': '1' },
  });
  expect(res.ok(), `${procedure}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
};

/** The same call for cleanup: whatever the backend answers (the object may already be gone). */
export const tryBackend = async (request: APIRequestContext, procedure: string, body: unknown): Promise<void> => {
  await request.post(`/ai_grid.v1.${procedure}`, { data: body, headers: { 'Connect-Protocol-Version': '1' } });
};

/**
 * Commits a model to the backend's Git catalog (the UI_API_REFERENCE's minimal one), placed on
 * the first fixture cluster: git mode requires a placement, and checks only that it names a
 * ManagedCluster (checkPlacementClusters, internal/servers/models_server.go).
 */
export const createModel = async (request: APIRequestContext, id: string, displayName: string): Promise<void> => {
  const { items } = await callBackend<{ items: { id: string }[] }>(request, 'Clusters/List', {});
  await callBackend(request, 'Models/Create', {
    object: {
      id,
      metadata: { name: id, annotations: { 'openshift.io/display-name': displayName } },
      spec: {
        model: { uri: 'hf://facebook/opt-125m', name: 'facebook/opt-125m' },
        replicas: 1,
        main: { image: 'quay.io/example/vllm:latest', requests: { cpu: '100m', memory: '1Gi' } },
        placement: { labelSelector: { matchExpressions: [{ key: 'name', operator: 'In', values: [items[0].id] }] } },
      },
    },
  });
};
