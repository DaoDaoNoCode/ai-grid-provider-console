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
  (`bff/internal/perses`). Perses authorizes and runs the queries;
- relays the browser's Connect calls to the backend's own RPCs (`/ai_grid.v1.<Service>/<Method>`,
  `bff/internal/relay`) behind the same caller checks as `/api/v1`: a reverse proxy that drops
  whatever the browser sent about who it is (`Authorization`, cookies, `Forwarded`, every
  `X-Forwarded-*`) and sets the caller exactly as `forwardIdentity` does for gRPC, passes only
  the Connect protocol (POST with a Connect content type, GET) with at most 1 MiB, bounds a unary
  call and every call's wait for headers by `BACKEND_TIMEOUT`, passes back only the response
  headers a Connect client needs, and never reads a body or compiles against the contract. A
  new RPC needs no change in the BFF; don't add per-RPC code there (`docs/plan/bff-api.md`, "The Connect relay").

What belongs in the backend, and so in the fake (`bff/internal/fakebackend`) until the backend
ships it: validation of values, normalization and defaults, resource versions and the
precondition check, list filtering, ordering and counting, deciding whether an update changes
anything, which keys a caller may change, and every field derived from other fields. Every object
the backend returns carries a non-empty `resource_version`: with `If-Match` required, an object
without one could never be updated or deleted.

## Adding a feature

New API work goes to the backend's own `ai_grid.v1`, and the page uses it through the generated
Connect client; [`docs/connect.md`](docs/connect.md) is the guide:

1. Add the field or RPC to `proto/ai_grid/v1` in ai-grid-cloud/ai-grid-provider-backend, with its
   implementation, following that repository's `docs/API_CONTRACT.md` (never a breaking change in
   one step).
2. Move `.backend-api-version` to a backend commit that has it and run `make generate-api`; commit
   `frontend/src/gen` with the change. Never edit `frontend/src/gen` or write TypeScript types that
   repeat a generated message.
3. Build the page on `frontend/src/api/connect` (typed clients, `describeError`), test it with
   `fakeClients`, and try it with `make dev-fake-infra`. The BFF needs no change.

Don't add new RPCs or fields to `mock/proto`. An area that still runs on the draft (until it moves
to `ai_grid.v1`) keeps the old steps, in `mock/proto/README.md`, "Working with the backend team":

1. Draft the RPC or field in `mock/proto/ai_grid/v1`, then run `make -C bff generate`.
2. Implement it in the fake, with the source of each behaviour cited next to the code, and test it
   there.
3. Map it in the BFF (`bff/internal/api`): transport only, as above. Add it to
   `docs/plan/bff-api.md`.
4. Build the page against it (`frontend/`).

Afterwards run `make -C bff golden` when the BFF's JSON or a fixture changed, and update the
docs (`docs/plan/bff-api.md`, `mock/AGENTS.md`, `mock/areas/*.md`) in the same change.

## The backend's own API over Connect

The console is moving to the backend's RPCs, called from the browser over Connect (ADRs 0002
and 0004). The foundation is in place; no page uses it yet:

- `.backend-api-version` holds the backend commit (one full SHA) whose `proto/` (package
  `ai_grid.v1`, not `ai_grid/draft`) the frontend is generated from. `make generate-api` writes
  `frontend/src/gen` (committed; never edit it, `make check-generated-api` fails CI when it
  differs). To move to a newer backend, change the SHA and regenerate in the same change.
- `frontend/src/api/connect`: `createConsoleTransport` (Connect JSON to the console's origin; on
  Unauthenticated it calls the console's `checkSession`), `createConsoleClients` (typed clients
  per service), `describeError` and `toServiceError` (a ConnectError as the UI states the pages
  already show), and `fakeClients` in `testing.ts` (typed in-memory fakes for tests).
- `make dev-fake-infra` runs the backend at that commit on its own fake hub and Keycloak (its
  `make dev-fake`, fetched into `.cache/backend/<sha>`, or `BACKEND_DIR`), the BFF against it
  and the frontend, so pages and the relay can be tried on the real backend without a cluster.
  `make dev-fake` (the console's own fake, serving the draft over gRPC only) is unchanged.

## The backend has no authentication yet

Authentication and authorization of API calls are out of the backend's MVP scope (decided
2026-10-20; ai-grid-cloud/ai-grid-provider-backend#3): it answers anyone who reaches it, as its
own ServiceAccount, which may label every ManagedCluster and, on the hub, read ACM Search's index
of every managed cluster. So in the console's pod:

- kube-auth-proxy is the only listener on the pod network (`:8443`), and the only port the
  Service and Route expose. The BFF and the backend bind to loopback, and every call reaches the
  backend through the BFF's caller checks (signed in, provider admin), on `/api/v1` and on the
  Connect relay alike.
- Don't add a Service port, Route, NetworkPolicy exception or `0.0.0.0` bind for the backend, and
  don't weaken the BFF's gates, until the backend authenticates callers itself (ADR-0004). The
  chart's kind test (`hack/test-chart-kind.sh`: only `:8443` listens off loopback) and
  ai-grid-env-setup's `verify/07-console.sh` (the backend's ports on loopback, the Service's one
  port) check this.
- Every container in the pod mounts the ServiceAccount token today. Limiting it to
  kube-auth-proxy and the backend was left out of the MVP; the planned end state is the backend
  calling the hub with the caller's own token, then in a pod of its own.

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
- The stopgap Models and Subscriptions clients (`bff/internal/backend/v1_models.go`, `v1.go`),
  until Models and Subscriptions move to the Connect clients:
  - the models namespace: reads give the BFF's `--models-namespace`, and a model elsewhere is
    NotFound;
  - the console's placement (the member labels plus `location In [...]`) is sent as
    `name In [...]`, and a read turns it back. The wizard counts a member as offered when
    `GET /locations` names either its cluster name (the backend) or its location label (the
    fake);
  - 501 for `createAuthPolicy: false`, and for a model list with a filter or an order;
  - a model or registration the backend reports as saved to Git (reason `SavedToGit`, no phase)
    keeps that reason, which the UI shows as Saved to Git;
  - a subscription update reads the subscription first and sends its annotations back with the
    display name and description changed, because the backend replaces the map whole;
  - a delete with `If-Match: "0"` is 412, because the backend treats version 0 as no check.
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
