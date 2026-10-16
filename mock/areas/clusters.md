# Clusters (ACM ManagedCluster)

What the fake backend and the BFF implement for this area, where they deviate from the
real hub, which texts are the console's own, and what remains. The fixture files are
described in `mock/fixtures/README.md`, the HTTP contract in `docs/plan/bff-api.md`, the
proto in `mock/proto/README.md`. Every hub string the fake writes is a constant in
`bff/internal/fakebackend/acm.go` with the upstream source line beside it (OCM `ocm` and
`api`, stolostron `managedcluster-import-controller`, `multicloud-operators-foundation` and
`console`); the research reports in `mock/research/` are background reading.

## Implemented

Fake: `ManagedCluster` carries annotations, conditions, claims, capacity, taints,
finalizers, `generation` and a derived `status.state`/`state_message`, computed on every read
in the ACM console's order (`bff/internal/fakebackend/state.go`). `scenarios.json` drives
join, import, add-ons, lease loss and recovery, API-server outage, detaching and removal
against an injectable clock with a `speed` factor; the hub controllers' reactions are applied
as each event fires (taint controller, add-on discovery and health check, autodetect, gc
controller; see `scenarios.go`). `GetManagedCluster` answers `NotFound` with the
conventions' message. `UpdateManagedCluster` validates the field mask (`labels`,
`annotations`, `hub_accepts_client`), replaces maps as a whole and then puts back what the
hub's webhook and controllers own (`name`, `cluster.open-cluster-management.io/clusterset=default`
when empty, the add-on labels, `clusterID`, `openshiftVersion*`,
`open-cluster-management/created-via`; a removed `cloud` or `vendor` stays removed), honours
`lock` with `Aborted`, bumps `resource_version` (and `generation` on a spec change), writes
`HubAcceptedManagedCluster` False/`HubClusterAdminDenied` when acceptance is withdrawn from a
cluster that was accepted (none for a cluster never accepted) and True/`HubClusterAdminAccepted`
when it is granted, and answers `PermissionDenied` with the API server's forbidden message for
a token `access.json` denies. Every RPC but `Ping` needs `authorization` metadata
(`Unauthenticated` otherwise).

BFF: `GET /api/v1/clusters/{name}` uses the Get RPC and sends the `resourceVersion` as the
`ETag`; `PATCH /api/v1/clusters/{name}` writes labels and annotations through the Update RPC
under optimistic locking, on the `If-Match` version when the client sends one (a stale tab
gets 409) and on the version it just read otherwise, and only the maps that differ from the
stored ones (a PATCH that repeats the stored values writes nothing); `GridCluster` exposes
`status`, `statusMessage`, `consoleUrl`, `kubernetesVersion`, `platform`, `product`,
`gpuCapacity`, `siteName`, `latitude`, `longitude`, `addons`, `conditions`, `resourceVersion`.

UI: main already has a basic, read-only Clusters page (`frontend/src/pages/ClustersPage.tsx`:
name, site, region, location, enrolment, provisioned, hub acceptance, OpenShift version), which
keeps working because the new fields are additive. Porting the fuller UI for this area (status,
GPUs, console link, enrol and location editing) is out of scope here; it builds on the HTTP
contract in `docs/plan/bff-api.md`. The map belongs to the grid overview area, not started
here; Placement recomputation and ManifestWorkReplicaSet belong to the models area
(`mock/areas/models.md`).

Backend ask: ship the draft's `GetManagedCluster`, `UpdateManagedCluster` and richer
message (`mock/proto/ai_grid/v1/managed_cluster*.proto`), with the state derived server-side.

## Fixture coverage

`mock/fixtures/managedclusters.json` holds ten clusters. They derive eight of the ten
`ManagedClusterState` values, `AVAILABLE` three times and the others once:

| State | Clusters |
|---|---|
| `AVAILABLE` | `local-cluster`, `site-paris-1`, `site-frankfurt-1` |
| `UNKNOWN` | `site-madrid-1` (lease expired) |
| `UNAVAILABLE` | `site-ashburn-1` (API server down) |
| `IMPORTING` | `site-berlin-1` |
| `PENDING_IMPORT` | `site-oslo-1` (`ManagedClusterWaitForImporting`) |
| `IMPORT_FAILED` | `site-dublin-1` |
| `NOT_ACCEPTED` | `site-lisbon-1` (denied after it had been accepted) |
| `DETACHING` | `edge-lyon-2` |

No fixture derives `UNSPECIFIED` (none has an empty condition list) or `PENDING` (never
derived). Other values seeded: add-on labels `available` (local-cluster with ten add-ons,
paris, frankfurt, ashburn, lyon), `unhealthy` (frankfurt's `application-manager`, an add-on
whose own lease stopped) and `unreachable` (madrid, lisbon); taint `unreachable` on madrid,
lisbon and the three not-joined clusters, `unavailable` on ashburn; `Deleting`
False/`ResourceRemaining` on lyon. Not seeded: `ManagedClusterForceDetaching`,
`ManagedClusterClockOutOfSync`, `HubAcceptedManagedCluster` reason `Error`, `Deleting`
`NoResource` (a `detaching` event on a cluster without add-on labels produces it) and
`DeletingError`. The region claim is present only on the AWS and Azure clusters; the
bare-metal ones omit it as the agent does when it finds none.

## Scenario

The shipped scenario (`mock/fixtures/scenarios.json`), in scenario time after the fake starts
(wall-clock time is that divided by `speed` in `mock/fixtures/settings.json`), and what each
event changes in the BFF's `GridCluster`:

| At | Cluster | Event | Visible change |
|---|---|---|---|
| 20s | `site-berlin-1` | `joined` | `status` importing to ready, `statusMessage`, three new conditions, `consoleUrl`, `kubernetesVersion`, `platform`, `product`, `gpuCapacity` 8, `openshiftVersion`, autodetect labels |
| 30s | `edge-lyon-2` | `detached` | the cluster is gone (404, absent from the list) |
| 70s | `site-berlin-1` | `imported` | only the `ManagedClusterImportSucceeded` entry of `conditions` (False/Importing to True/Imported) and `resourceVersion`; `status` is already ready |
| 90s | `site-berlin-1` | `addons-available` | `addons`: work-manager, cluster-proxy, managed-serviceaccount |
| 130s | `site-berlin-1` | `addons-available` | `addons`: the seven default add-ons |
| 300s | `site-madrid-1` | `lease-recovered` | `status` unknown to ready, `statusMessage`, add-ons `available` |

## Deviations from the real hub

- Controllers act at once: each scenario event applies the hub controllers' reactions at the
  event's time, and `UpdateManagedCluster` applies the webhook's and controllers' follow-up
  writes before it answers. On a hub the controller writes land shortly after the request, and
  a lease is declared lost from `leaseDurationSeconds`, not by a scheduled event.
- `cloud`, `vendor` and `clusterID` are written at `joined`. On a hub they follow once the
  work-manager add-on has synced ManagedClusterInfo; `openshiftVersion*` does come at join.
- `addons-available` writes `available` directly. On a hub each label first appears as
  `unreachable` when its ManagedClusterAddOn is created. `lease-recovered` sets every add-on
  label `available`; on a hub each add-on reports its own state again.
- `Deleting` counts the add-on labels as the ManagedClusterAddOns left in the cluster
  namespace and the add-ons that carried a finalizer on the dev hub (config-policy-controller,
  hypershift-addon, submariner) as "finalizer pending". The later ManifestWorks phase, the
  step-by-step finalizer removal and the namespace cleanup are not modelled; `detached`
  deletes the object at once.
- Withdrawing acceptance only rewrites the condition. On a hub the registration controller
  also removes the agent's RBAC, so the lease soon expires and the cluster turns Unknown (as
  lisbon shows); the fake does not follow up. An accept that fails (`Error` reason) is not
  simulated.
- The default clusterset label is put back for every token the fake hub accepts; the real
  webhook does so only for a caller allowed to join the `default` ManagedClusterSet.
- `generation` bumps on `hub_accepts_client` and hub taint changes, the only spec changes the
  fake makes, and once when deletion is requested (the API server's `markAsDeleting`); fixture
  generations follow that history.
  `resourceVersion` is a counter.
- Finalizers are static fixture data; the fake neither adds nor removes them.
- No CertificateSigningRequests, HostedClusters or ClusterDeployments: the ACM console's
  `needsapproval`, hosted-import and provisioning states are not derived.
- `filter` and `order` on `ListManagedClusters` are drafted but answer `InvalidArgument`.

## Console-invented texts

Nothing on the hub writes these; the console (fake and draft proto) does:

- `state_message` on every state. The ACM console shows a message only for importing,
  importfailed, offline and unknown; for ready, pendingimport, notaccepted and detaching the
  console's backend proposal repeats the deciding condition's message.
- `NotFound`: `object with identifier '<name>' not found` (the conventions' shape, from OSAC).
- `Aborted`: `object with identifier '<name>' has resource version <v>, the request carries "<v>"; fetch it again and retry`.
- `InvalidArgument`: `name is required`, `object.name is required`,
  `update_mask must name at least one of labels, annotations, hub_accepts_client`,
  `update_mask path "<p>" is not supported; supported paths: labels, annotations, hub_accepts_client`,
  `offset must not be negative, got <n>`, `limit must not be negative, got <n>`,
  `filter is not supported by this server yet`, `order is not supported by this server yet`.
- `Unauthenticated`: `missing authorization metadata`,
  `authorization metadata must be 'Bearer <token>'`, `the hub rejected the token: Unauthorized`.
- The `PermissionDenied` text is the Kubernetes API server's forbidden message, not invented.
- The `api-down` default detail `the server is currently unable to handle the request` is
  the Kubernetes 503 text; the event can carry another code and detail.

## What remains

The UI pages for this area (owned by the UI port), the grid map, and the backend shipping
the draft RPCs. Filter and order on the list wait for the backend's choice of language.
