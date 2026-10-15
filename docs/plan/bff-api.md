# BFF plan

The console is a React and PatternFly frontend served by a Go backend-for-frontend (BFF)
that runs on the ACM hub. This document fixes the BFF's shape so that work can be split
across people and agents without re-deciding the basics.

The feature plan that this implements is `ai-grid-provider-portal-ui-plan.md` (Steps 0 to
11). That plan was written against Kris Verlaenen's Node POC
(`krisv/ai-grid-cloud-provider-poc`). Its API shapes and ACM resource conventions are kept;
its Node backend is replaced by the Go BFF described here.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Language | Go, standard library `net/http` router, `client-go` | Matches the odh-dashboard BFFs (`packages/*/bff`) the team already maintains; no framework to learn. |
| Identity | Every request carries the caller's OpenShift token in `x-forwarded-access-token`. The BFF builds a Kubernetes client with that token per request. | Same model as the odh-dashboard BFFs. The cluster's RBAC decides what the user may do; the BFF holds no privileged credential. Replaces the POC's single service-account token (Step 1 of the feature plan). Open: the auth setup for AI Grid is not yet aligned (Andrew Ballantyne asked Lindani Phiri on 2026-10-14); if the tenant API layer brings its own identity provider, the proxy's provider changes, not the BFF. |
| Login in cluster | `kube-auth-proxy` sidecar (`quay.io/opendatahub/odh-kube-auth-proxy`) with `--provider=openshift --pass-access-token`. | It is the proxy RHOAI uses; it performs the OpenShift OAuth flow and sets `X-Forwarded-Access-Token` for the BFF. See `manifests/`. |
| Login in development | The frontend dev server and `hack/api.sh` inject `oc whoami -t`. The BFF reads the API server URL and CA from the kubeconfig, never its token. | Lets any developer who has run `oc login` work against a real hub with their own permissions. |
| Hub namespace | Portal-owned hub resources (Placement, ManifestWorkReplicaSet, LLMInferenceService template, MaaSModelRef) live in one namespace, flag `--hub-namespace`, default `ai-grid`. | The POC used `maas`; the name is configurable so a hub can pick. |
| Cluster labels | `ai-grid/enabled`, `ai-grid/provisioned`, `location` on `ManagedCluster`. | Kept from the POC so Placements written by either tool select the same clusters. |
| Response envelope | Success: `{"data": ...}`. Error: `{"error": {"code": "<http status>", "message": "..."}}`. | Same as the odh-dashboard BFFs; the frontend code there can be reused. |
| Concurrency | Mutations of a hub resource send `If-Match: <resourceVersion>`; a stale version returns 412, a missing header on delete returns 428. | Kubernetes already gives us `resourceVersion`; no Git revisions as in the POC. |
| Tests | `client-go` fake clientsets and `httptest`; no envtest. | Fast, no binaries to download. A `hack/smoke.sh` script checks the live cluster. |

## Modules

```
bff/
  cmd/                  flags, server start and graceful stop
  internal/config       EnvConfig (flags and env vars)
  internal/api          App, routes, middleware, error responses, handlers
  internal/kube         ClientFactory (per-request token clients), RequestIdentity
  internal/clusters     ManagedCluster projection (GridCluster), list, enroll, locations
  internal/models       (next) Placement + ManifestWorkReplicaSet writer and status reader
  internal/subscriptions (later) MaaSSubscription fan-out
```

Each domain package exposes a `Repository` interface taking a `kube.Client` so handlers are
tested with fakes and the live client is only wired in `api.NewApp`.

## Endpoints

Paths are under `/api/v1`. Resource shapes follow the POC's `docs/openapi.json` unless noted.

### Slice 1: foundation (this branch)

| Method | Path | Returns | Source |
|---|---|---|---|
| GET | `/healthcheck` | `{status, version}` | none, no auth |
| GET | `/api/v1/user` | `{username, groups, isProviderAdmin}` | `SelfSubjectReview`; admin = `SelfSubjectAccessReview` for `patch managedclusters.cluster.open-cluster-management.io` |
| GET | `/api/v1/config` | `{hubNamespace, gridEndpoint, mapTileUrl, billingUrl}` | flags / env `GRID_CONSUMER_URL`, `MAP_TILE_URL`, `BILLING_URL` |
| GET | `/api/v1/clusters` | `GridCluster[]` | list `ManagedCluster` (paged, `limit=500`) |
| GET | `/api/v1/clusters/{name}` | `GridCluster` | get `ManagedCluster` |
| PATCH | `/api/v1/clusters/{name}` | `GridCluster` | merge-patch labels; body `{aiGridEnabled: true}` and/or `{location: "<label value>"}` |
| GET | `/api/v1/locations` | `string[]` | distinct `location` of clusters that are Ready, enabled and provisioned |

`GridCluster`:

```json
{
  "name": "local-cluster",
  "status": "Ready | Offline | Unknown",
  "aiGridEnabled": true,
  "provisioned": false,
  "provisioningStatus": "Provisioned | Provisioning | Not provisioned",
  "location": "us-east-1",
  "consoleUrl": "https://console-openshift-console.apps...",
  "openshiftVersion": "4.22.15",
  "resourceVersion": "12345"
}
```

`status` comes from the `ManagedClusterConditionAvailable` condition. `consoleUrl` comes from
the `consoleurl.cluster.open-cluster-management.io` cluster claim (feature plan Step 11).

### Slice 2: models (feature plan Steps 3, 4, 9)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/models` | `ManagedModel[]` with `locations`, `sites[]`, `rollout` |
| POST | `/api/v1/models` | writes Namespace-safe ManifestWorkReplicaSet + Placement + MaaSModelRef in the hub namespace; see feature plan 3a for `feedbackRules` and `deleteOption: SelectivelyOrphan` |
| GET | `/api/v1/models/{name}` | adds per-site status from PlacementDecisions and generated ManifestWorks (selected by the `work.open-cluster-management.io/manifestworkreplicaset` label, never by name) |
| PATCH | `/api/v1/models/{name}` | `{locations}` rewrites the Placement |
| PUT | `/api/v1/models/{name}` | settings change rolled out to all sites |
| DELETE | `/api/v1/models/{name}` | refuses while a subscription references the model |
| GET/POST/PUT/DELETE | `/api/v1/catalog[/{name}]` | portal-private `ModelCatalogEntry`, stored as a ConfigMap in the hub namespace (the POC stored it in Git) |

Prerequisites on the hub, to be checked by `GET /api/v1/config` once implemented:
`ManifestWorkReplicaSet` feature gate on `ClusterManager.spec.workConfiguration.featureGates`
and a `ManagedClusterSetBinding` in the hub namespace. The dev hub
`ai-grid-tenant` has the CRD but not the feature gate today.

### Slice 3: subscriptions, grid, fleet, tenants (feature plan Steps 5, 6, 8, 10)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/v1/subscriptions` | `MaaSSubscription` + `sub-<name>` Placement and ManifestWorkReplicaSet (Step 8) |
| GET/PUT/DELETE | `/api/v1/subscriptions/{name}` | |
| GET | `/api/v1/grid` | `GridNetwork`, `GridSite[]`, `InferenceProvider[]` from `grid.praxis.fast/v1alpha1`; empty when the CRDs are absent. The CRDs and the Praxis gateways are installed by the RHOAI AI Gateway component (`DataScienceCluster.spec.components.aigateway.aiGrid`, odh-gitops PR 181 / RHAISTRAT-2845, RHOAI 3.6), not by hand |
| PATCH | `/api/v1/grid/network`, `/api/v1/grid/providers/{name}` | |
| GET | `/api/v1/fleet`, `/api/v1/fleet/sites/{name}` | proxy to `FLEET_DASHBOARD_URL` |
| GET/POST/PUT/DELETE | `/api/v1/tenants[/{name}]` | Against the tenant API layer being defined with Swati's team (kick-off 2026-10-15). It is "OSAC-like" and will later migrate into OSAC outside RHOAI (Dana Gutride, 2026-10-14). OSAC itself is not used in this round. Until a spec exists the frontend uses the mock service; the BFF gets a `tenants.Repository` interface with no implementation |

## Errors

| Situation | Status | `code` |
|---|---|---|
| Missing or empty token header | 401 | `401` |
| Kubernetes returns 401 | 401 | `401` |
| Kubernetes returns 403 | 403 | `403` |
| Resource not found | 404 | `404` |
| Body fails validation | 422 | `422` |
| `If-Match` stale / missing on delete | 412 / 428 | `412` / `428` |
| Kubernetes unreachable or 5xx | 503 | `503` |

## Out of scope for the BFF

- No Git store. Hub resources are the source of truth.
- No per-tenant usage totals (feature plan: deliberately excluded until a source exists).
- No billing data. Nothing in the platform stores it (Andrew Ballantyne, 2026-10-14), and whether
  AI Grid gets a cost or spend view at all is an open product question. `billingUrl` in
  `/api/v1/config` is a plain external link that stays empty until a page exists.
- No OSAC integration in this round (see tenants above).
- No session handling. The proxy owns login and cookies.
