# Working in this repository

Rules for every coding agent (and person) changing this repository. There is no root
`CLAUDE.md`; this file applies to all agents. To build console pages against the fake backend,
read [mock/AGENTS.md](mock/AGENTS.md).

## The BFF does transport only

The console is a React frontend, a thin Go BFF (`bff/`) and `ai-grid-backend`, a gRPC service in
its own repository (`docs/plan/bff-api.md`). The backend is meant to be a provider API that
stands on its own: a CLI, GitOps tooling and other UIs will call it without the BFF. So anything
that decides what data means, or what a request may do, belongs in the backend; if it lived in
the BFF, every other client would have to copy it. The draft proto also follows OSAC's
conventions (`mock/research/backend-conventions.md`): a List request carries only `offset`,
`limit`, `filter` (CEL) and `order`, and an Update replaces a map field as a whole (FieldMask
semantics, no `labels.<key>` paths). The client writes the CEL filter and edits the map it
loaded; the BFF forwards both unchanged; the backend evaluates the filter and applies the update
under optimistic locking.

What the BFF does:

- decodes request bodies strictly: exactly one JSON object, no unknown fields, at most 1 MiB;
- answers 415 for a POST, PATCH or PUT that is not `application/json`;
- requires `If-Match` on PATCH and DELETE (428 without it) and maps it to the request's version
  field (`resource_version`, with `lock: true` where the RPC has one);
- maps query parameters to the List request (`offset`, `limit`, `filter` as sent);
- maps gRPC codes to HTTP statuses, keeping the backend's message, and its own body errors to 422;
- forwards the caller's identity (the token as `authorization`, plus user, email and groups);
- serves the SPA, `/healthcheck`, `/readyz`, `/api/v1/config`, and asks the hub for
  `isProviderAdmin` (a `SelfSubjectAccessReview` with the caller's token);
- relays `/perses/api` to the hub's Perses with the caller's token, for the Monitoring page:
  only the read and query paths the Perses components call, nothing else of the caller's
  (`bff/internal/perses`). Perses authorizes and runs the queries.

What belongs in the backend, and so in the fake (`bff/internal/fakebackend`) until the backend
ships it: validation of values, normalization and defaults, resource versions and the
precondition check, list filtering, ordering and counting, deciding whether an update changes
anything, which keys a caller may change, and every field derived from other fields. Every object
the backend returns carries a non-empty `resource_version`: with `If-Match` required, an object
without one could never be updated or deleted.

## Adding a feature

Follow `mock/proto/README.md`, "Working with the backend team":

1. Draft the RPC or field in `mock/proto/ai_grid/v1`, then run `make -C bff generate`.
2. Implement it in the fake, with the source of each behaviour cited next to the code, and test it
   there.
3. Map it in the BFF (`bff/internal/api`): transport only, as above. Add it to
   `docs/plan/bff-api.md`.
4. Build the page against it (`frontend/`).

Afterwards run `make -C bff golden` when the BFF's JSON or a fixture changed, and update the
docs (`docs/plan/bff-api.md`, `mock/AGENTS.md`, `mock/areas/*.md`) in the same change.

## Known exceptions, to move behind the RPCs later

The BFF still derives or decides these itself. Do not add more; move these into the backend
when the RPCs allow it.

- `toGridCluster` (`bff/internal/api/clusters.go`): `aiGridEnabled` and `provisioned` (the
  `ai-grid/enabled` and `ai-grid/provisioned` labels equal to `"true"`; when the backend reports
  `status.provisioning`, `provisioned` is that equal to `"Compliant"` instead, until the backend
  serves a provisioned state), `location`, `site`,
  `region` and `openshiftVersion` from labels; `siteName`, `latitude` and `longitude` from the
  `ai-grid/site-name`, `ai-grid/latitude` and `ai-grid/longitude` annotations, with coordinates
  that do not parse or are out of range left out; `consoleUrl`, `platform` and `product` from
  cluster claims; `gpuCapacity` from `status.capacity["nvidia.com/gpu"]`; `addons` from the
  `feature.open-cluster-management.io/addon-*` labels; the list sorted by name.
- `fetchCluster`: when `GetManagedCluster` answers `Unimplemented`, the BFF filters
  `ListManagedClusters` by name and writes its own NotFound message. Neither the fake nor the
  shipped backend (`mock/proto/upstream/COMMIT`, whose `Clusters/Get` `v1.go` calls) answers
  that any more, so this only serves an older backend; remove it once none is deployed.
- The stopgap clients for the backend's current `ai_grid.v1` (`bff/internal/backend/v1.go`),
  until the console moves to Connect and the backend's contract: `FromV1Cluster` derives the
  draft's cluster state from `spec.hub_accepts_client`, `status.joined`,
  `status.available_condition` and the deletion time, and the tenant writes refuse with
  `Unimplemented` the draft fields the backend's `Tenant` lacks. They accept those fields when
  they hold what a read shows (`description: ""`, `enabled: true`, `attributes: {}`), which may
  not be what Keycloak stores (`readBackValue`), and send a PATCH that sets only such fields as
  an update with the mask `id`.
- `toTenant` (`bff/internal/api/tenants.go`), fallbacks for the shipped backend: `enabled`
  defaults to true, `domainDetails` is built from `domains`.
- `toModel` (`bff/internal/api/models.go`): `displayName` and `description` from the
  `openshift.io/display-name` and `openshift.io/description` annotations; `modelName` defaults to
  the model name; `placement.selectedClusters` from the decisions; `placement.satisfied`,
  `reason` and `message` from `PlacementSatisfied`; `rollout.rolledOut`, `applied` and `reason`
  from `PlacementRolledOut` and `ManifestworkApplied`; each work's `applied`, `available`,
  `progressing` and `degraded` from its conditions and `feedback` from the manifest feedback
  values; `rollout.strategy` shown as `All` when unset.
- `fromRolloutSpec`: parses the rollout strategy name into the enum and answers 422 for an
  unknown one; an empty strategy is sent as `ROLLOUT_STRATEGY_ALL`, a default the backend
  should apply to `ROLLOUT_STRATEGY_UNSPECIFIED`.
- `toGridOverview` (`bff/internal/api/grid.go`): drops metric points whose value is NaN or
  ±Inf (JSON cannot carry them), always sends `demo: false`, and writes `updatedAt` as
  `2006-01-02T15:04:05.000Z` (the PoC's millisecond format) whatever precision the backend
  sends.
- The model create (`createModel`): `cpu`, `memory` and `gpuCount` become the main container's
  requests (the GPU also its limit, a negative `gpuCount` is 422); `scaling` becomes a KEDA
  block; the gateway defaults to `openshift-ingress/openshift-ai-inference`; the managed route
  and the scheduler are always on.
- `requireTotal` (`bff/internal/api/respond.go`): a list answer without `total` comes from a
  backend that ignored `filter`, `offset` and `limit` (the shipped one), so the BFF answers 501
  when the caller sent any of them; without them `listMeta` falls back to a total it can prove.
  This is compatibility with the shipped backend, not filtering.
- `requireProviderAdmin` (`bff/internal/api/middleware.go`), the BFF's one authorization
  decision: every `/api/v1` call except `GET` (or `HEAD`) `/user` and `/config` needs the caller's
  `isProviderAdmin` review to pass (403 otherwise), until the backend authorizes the caller.
