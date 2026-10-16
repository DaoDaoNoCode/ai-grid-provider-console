# Clusters (ACM ManagedCluster)

What the fake backend and the BFF implement for this area, where they deviate from the
research, which texts are invented, and what remains. The fixture data is described in
`mock/fixtures/README.md`, the HTTP contract in `docs/plan/bff-api.md`, the proto in
`mock/proto/README.md`. The research reports cited here (`mock/research/`) are background
reading.

Implemented. Fake: `ManagedCluster` carries annotations, conditions, claims, capacity,
taints, finalizers and a derived `status.state`/`state_message` computed on every read in
the ACM console's order; the fixtures seed one cluster per state (ten clusters, every enum
value but the superseded `PENDING`); `scenarios.json` drives import (joined, imported,
add-ons), lease loss and recovery, API-server outage, detaching (with `Deleting`) and removal
against an injectable clock with a `speed` factor; `GetManagedCluster` answers `NotFound`
with the conventions' message; `UpdateManagedCluster` validates the field mask (`labels`,
`annotations`, `hub_accepts_client`), replaces maps as a whole, honours `lock` with
`Aborted`, bumps `resource_version` (and `generation` on a spec change), flips
`HubAcceptedManagedCluster` to `HubClusterAdminDenied` when acceptance is withdrawn, and
answers `PermissionDenied` for a token `access.json` denies; every RPC but `Ping` needs
`authorization` metadata (`Unauthenticated` otherwise).
BFF: `GET /api/v1/clusters/{name}` uses the Get RPC; `PATCH /api/v1/clusters/{name}` writes
labels and annotations through the Update RPC under optimistic locking; `GridCluster` exposes
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

The shipped scenario (`mock/fixtures/scenarios.json`), in scenario time after the fake starts
(wall-clock time is that divided by `speed` in `mock/fixtures/settings.json`);
`bff/internal/fakebackend/scenarios.go` says what each event changes:

| At | Cluster | Event |
|---|---|---|
| 20s | `site-berlin-1` | `joined` |
| 30s | `edge-lyon-2` | `detached` |
| 70s | `site-berlin-1` | `imported` |
| 90s | `site-berlin-1` | `addons-available` |
| 130s | `site-berlin-1` | `addons-available` |
| 300s | `site-madrid-1` | `lease-recovered` |
