# Building UI against the fake backend

> **The contract below is being replaced.** Everything on this page is accurate today and is
> how you build a page today. But under
> [ADR-0001](../docs/adr/0001-the-contract-lives-in-the-backend.md) the contract moves to
> `ai-grid-cloud/ai-grid-provider-backend`, and the fake and its fixtures move with it, and
> under [ADR-0002](../docs/adr/0002-connect-end-to-end-with-vanguard-for-rest.md) the browser
> speaks Connect — so the JSON envelope and the HTTP status table on this page go away (the
> `ETag`/`If-Match` protocol already went with the last JSON write). Don't invest in the parts marked for deletion; do read
> ADR-0001 before adding an RPC.
>
> **The backend copy has landed** (merged 2026-10-22). It carries the draft as `ai_grid.draft.v1` on its own port, the fake as
> `internal/fakeinfra/draft/`, and the fixtures as `fixtures/draft/{default,poc}`.
> It is **not** reconciled to OSAC conventions in
> one step: each area is reshaped and deleted from the draft as the real backend implements it,
> so the other pages keep working meanwhile. Console cleanup remains pending and removes
> the draft proto, generated draft code and `bff/internal/fakebackend` from here. Clusters,
> Models, Subscriptions and Organizations have already moved to real backend services. Their
> pages call the backend's API over Connect, so they run on `make dev-fake-infra`, not on this
> fake, which serves no subscriptions or tenants and whose clusters and models no console page
> reads. The vendored upstream proto and drift guard remain during migration.

Monitoring shows the hub's Perses dashboards through the BFF's Perses relay when the console
is configured with a Perses, and says it is not set up otherwise; it uses nothing of this fake.

The entry point for a coding agent (or a person) building console pages against the fake
`ai-grid-backend`. It says what runs, what the BFF answers and what the fixtures seed, and
points to the detail:

| For | Read |
|---|---|
| What the BFF may do (transport only) and what belongs to the backend and so to the fake | [../AGENTS.md](../AGENTS.md) |
| Every endpoint, JSON shape, body rule and error mapping | [docs/plan/bff-api.md](../docs/plan/bff-api.md) |
| The draft proto the BFF and the fake compile against, and the deliberate stubs | [proto/README.md](proto/README.md) |
| The fixture files and what each one seeds | [fixtures/README.md](fixtures/README.md) |
| What the fake and the BFF implement per area, deviations, invented texts, what remains | [areas/clusters.md](areas/clusters.md), [areas/models.md](areas/models.md); [areas/tenants.md](areas/tenants.md) says where the organizations went |
| What the BFF returns for the shipped fixtures | [examples/](examples/) (below) |

Background reading, not needed to build against the fake: [README.md](README.md) on why the
console runs against a fake, and `research/` for the sources behind the fake's strings and
timings when that directory is present.

## Run it

```sh
make install     # once: frontend dependencies
make dev-fake    # fake backend gRPC :9090, fake hub :9091, BFF :8080, Vite :9000
```

Open http://127.0.0.1:9000. No cluster and no `oc login` are needed. The Vite dev proxy sends
`AUTH_TOKEN` as `x-forwarded-access-token` and `AUTH_USER` as `x-forwarded-user`; the fake
hub and the fake backend decide by token alone (`fixtures/access.json`):

| `AUTH_TOKEN` | Who you are |
|---|---|
| `dev-token` (default, user `dev-user`) or any token not listed below | provider admin: reads and writes |
| `viewer-token` (`AUTH_USER=viewer`) | signed in, not a provider admin: `GET /api/v1/user` and `GET /api/v1/config` work; every other `/api/v1` request is 403 from the BFF (see "Errors") |
| `expired-token` | rejected by the hub and the backend: 401 from every endpoint but `/api/v1/config` (see "Errors") |

Without the frontend, call the BFF directly:

```sh
curl -s -H 'x-forwarded-access-token: dev-token' -H 'x-forwarded-user: dev-user' \
  http://127.0.0.1:8080/api/v1/user
```

The browser tests (`make e2e`) start the same fake on `fixtures-poc/` instead (the PoC's four
sites and three models, no scenario events, no latency),
from `frontend/playwright.config.ts`. To run the pieces separately, see
`docs/dev-setup.md`, "Run the pieces separately".

This fake serves the console's draft over gRPC only, so the Connect relay (`/ai_grid.v1.*`,
`docs/plan/bff-api.md`, "The Connect relay") has nothing to reach here. For a page built on the
backend's own RPCs over Connect (`frontend/src/api/connect`), run `make dev-fake-infra` instead:
the real backend at `.backend-api-version` on its own repository's fake hub and Keycloak, with the
same tokens (`dev-token`, `viewer-token`, `expired-token`) and the same ports, so not both at once
(`docs/dev-setup.md`, "On the backend's own fakes").

The fake backend (`bff/cmd/fake-backend`) serves the backend's gRPC services from
`fixtures/` and answers the BFF's access review like a hub would. The fake hub answers one
question only, the provider-admin check (`patch` on `managedclusters` in
`cluster.open-cluster-management.io`); any other access review is a 400 that names both and is
logged, so a BFF that asks the wrong question fails instead of being answered by token. Its gRPC services need
`authorization` metadata like the real backend; the BFF forwards it from the proxy headers, with
the user, email and groups percent-encoded (`docs/plan/bff-api.md`, Identity), and the fake
decodes the user it logs and names in its 403 messages.
Edit the fixtures and restart to change the fleet or the models:
`manifestWorkReplicaSetEnabled: false` in `settings.json` mirrors the dev hub: creating a
model with a `placement` is refused with 412, and the seeded placed models read `pending` with
an empty rollout status. The fake moves clusters and models over time (see "Timed scenarios").

## The HTTP contract

[docs/plan/bff-api.md](../docs/plan/bff-api.md) is the contract: every endpoint, the JSON
shapes with examples, the body rules and the error table. The BFF's structs in
`bff/internal/api/*.go` are what it encodes. Every success is `{"data": ...}`; every error is
`{"error": {"code": "<status>", "message": "..."}}`. Every `/api/v1` path needs
`x-forwarded-access-token` (401 without it); `x-forwarded-user`, `-email` and `-groups` are
optional. Every route reads: the writes go to the backend over Connect.

| Method | Path | Request body | Response `data` |
|---|---|---|---|
| GET | `/api/v1/user` | | `{username, email?, groups, isProviderAdmin}` |
| GET | `/api/v1/config` | | `{gridEndpoint, mapTileUrl, mapTileAttribution, billingUrl, version, fakeBackend, monitoring: {enabled, persesProject}, models: {hardware}}`; `hardware` is the BFF's built-in NVIDIA GPU and CPU only unless `MODEL_HARDWARE` sets a list |

## Golden responses (`examples/`)

What the BFF returns for the shipped fixtures at scenario time zero, one file per request:
`{"request", "requestBody"?, "token", "user", "status", "responseHeaders"?, "body"}`, with
`body` as the BFF encoded it (re-indented) and `responseHeaders` the `Allow` header when the
BFF set it.

| File | Request |
|---|---|
| `get-user.json` | `GET /api/v1/user` as `dev-user` |
| `get-config.json` | `GET /api/v1/config` (every setting at its default) |
| `error-401-expired-token.json` | `GET /api/v1/user` with `expired-token` |
| `error-403-viewer.json` | `GET /perses/api/api/v1/projects/ai-grid/dashboards`, the Monitoring page's list of dashboards, with `viewer-token` |
| `error-404-unknown-path.json` | `GET /api/v1/tenants`, a path the BFF no longer has (the organizations are the backend's, over Connect) |
| `error-405-wrong-method.json` | `POST /api/v1/config`: 405 with `Allow: GET, HEAD` |

They are produced by `bff/internal/examples/golden_test.go`, each on a BFF and fake of its
own: the fake backend loaded from `fixtures/` over an in-memory gRPC connection with its clock
frozen at 2026-10-15T12:00:00Z, no latency, deterministic uids and work names (`g0001`, ...),
the fake hub over `httptest`, and the real BFF handler. `go test ./...` (and so CI) fails when a
file no longer matches. After changing a fixture or the BFF's JSON, regenerate and review the
diff:

```sh
make -C bff golden    # go test -count=1 ./internal/examples -run Golden -update
```

The running fake differs from the files only in what moves: times, `resourceVersion`, the
scenario state, work names (a random five-character suffix instead of `g0001`) and `version` in
`/api/v1/config` (the git revision under `make dev-fake`, `dev` in the files).
Never hard-code those.

## What the fixtures seed (`fixtures/`)

The summary below is what a page needs; [fixtures/README.md](fixtures/README.md) has every
field, and `areas/*.md` what the fake derives from them.

**Clusters** (`managedclusters.json`), every state the ACM console shows at least once, as
`status` (`ready` three times; no cluster lacks conditions, so `status` is never omitted):

| Cluster | `status` | Notes |
|---|---|---|
| `local-cluster` | `ready` | the hub itself; one L4 GPU (`gpus`: 1 node x 1) |
| `site-paris-1` | `ready` | enrolled and provisioned, 32 GPUs (`gpus`: H200, 4 nodes x 8), site name and coordinates |
| `site-frankfurt-1` | `ready` | not enrolled (no `ai-grid/*` labels), 8 GPUs in two configurations (H100 x4 on 1 node, L40S x2 on 2 nodes, one not Ready), add-on `application-manager` `unhealthy` |
| `site-madrid-1` | `unknown` | lease expired, `unreachable` taint, add-ons `unreachable`; enrolled and provisioned; `ai-grid-mock/fail-apply=mistral-7b-instruct`, so only Mistral's work fails to apply there; 4 MIG devices (`gpus`: A100 3g.20gb, MIG `single`) |
| `site-ashburn-1` | `offline` | API server down, `unavailable` taint; add-ons still `available` (the hub changes them only on a lost lease); 8 GPUs as 2 L4s time-sliced x4 |
| `site-berlin-1` | `importing` | no claims yet |
| `site-oslo-1` | `pendingimport` | |
| `site-dublin-1` | `importfailed` | |
| `site-lisbon-1` | `notaccepted` | `hubAcceptsClient: false` |
| `edge-lyon-2` | `detaching` | `Deleting=False/ResourceRemaining` while its add-ons drain; 2 GPUs in its capacity, no `gpus` (Search has nothing for it) |

GPU inventories (`status.gpus` on `GridCluster.gpus`) come from `gpunodes.json`, the GPU nodes as
ACM Search returns them; a cluster without an entry there has none.

**Models** (`models.json`, namespace `ai-grid-models`):

| Model | `phase` at start | What it shows |
|---|---|---|
| `tiny-llm` | `ready` | a hub deployment, no placement |
| `granite-8b-instruct` | `ready` (`Complete`) | placed on enrolled and provisioned sites: `site-paris-1` at start; `site-madrid-1` joins at 300 s, when its lease recovers (`partiallyavailable` while Madrid's starts, `ready` on two sites from about 345 s) |
| `mistral-7b-instruct` | `pending` (`NotAsExpected` at 0 s, then `Processing`) | created when the fake starts; a Progressive rollout one site at a time in cluster-name order: `site-frankfurt-1` at once (ready at about 45 s), `site-berlin-1` (selected once it joins at 20 s; applied at about 75 s, after `minSuccessTime` 30 s), `site-paris-1` (applied at about 150 s), `ready` at about 195 s (`partiallyavailable` between a site's ready and the next one's); `site-madrid-1` is added at 300 s and fails to apply there (`ai-grid-mock/fail-apply`), so it stays `partiallyavailable`, serving on three of four clusters (proposal P13) |
| `llama-3-70b` | `failed` (`ConfigNotFound`) | a preset the hub lacks |
| `codellama-13b` | `pending` (`PlacementDecisionEmpty`) | a placement that matches no cluster |

`settings.json` holds `latency` (40ms per RPC), `speed` and the hub capabilities (see
[fixtures/README.md](fixtures/README.md) for what a missing file defaults to);
`access.json` the tokens; `presets.json` the installed KServe presets; `scenarios.json` the
cluster events below. A fixture that fails to load stops the fake with the reason.

## Timed scenarios

Times below are scenario seconds after the fake starts (for a model: after it was created; for a
placed model's site: after its agent first reported). `speed` in `settings.json` scales
wall-clock time: an event at scenario time `t` happens `t / speed` real seconds in, so `10` plays
the 300 s cluster scenario in 30 s (default `1`). It applies to the cluster events and the model
lifecycles alike. Restart the fake to replay.

| At | What changes |
|---|---|
| 20 s | `site-berlin-1` joins: `status` `importing` to `ready`; claims, capacity (8 GPUs) and version appear |
| 30 s | `edge-lyon-2` finishes detaching and disappears from the list |
| 70 s | `site-berlin-1`'s `ManagedClusterImportSucceeded` condition turns True (and its `resourceVersion` moves); `status` stays `ready` |
| 90 s, 130 s | `site-berlin-1` add-ons become available (three, then all seven) |
| 300 s | `site-madrid-1` recovers its lease: `unknown` to `ready`; `granite-8b-instruct` and `mistral-7b-instruct` roll out to it: Granite reads `partiallyavailable` until its work there is ready, about 45 s later, then `ready`; Mistral's work fails to apply there, so Mistral stays `partiallyavailable` |

A model the fake creates (its own tests' `CreateModel`, and `mistral-7b-instruct` at start) walks
KServe's conditions, counted from its creation:

| At | `Ready` and what else changes |
|---|---|
| 0 s | no conditions yet |
| 5 s | `False/WaitingForGateway`: nine conditions; presets combined (`appliedConfigs` filled), gateways ready, the Deployment and the route created, so `url` and the six `addresses` appear now, before the model is ready |
| 15 s | `False/Progressing`: route, pool and scheduler accepted and ready |
| 20 s | `False/MinimumReplicasUnavailable` |
| 45 s | `True`, so `phase` reads `ready` (the Deployment's ready replica count is in the gRPC `status.workloads` only; the BFF does not return it yet) |

A hub deployment's `phase` reads `pending` while it starts, with the reason KServe reports
(`WaitingForGateway`, `Progressing`, `MinimumReplicasUnavailable`), and `failed` only for a
reason that does not recover on its own (`ConfigNotFound`, `RefsInvalid`, `GatewaysNotReady`). A
placed model's sites follow the same table, counted from the moment the site's agent reports its
work: `Applied` at once, `Available` 2 s later, the spoke ready at 45 s; `Progressive` moves to
the next site once the current one is ready and `minSuccessTime` has passed. Failures on demand:
an unknown `baseRefs` entry stops at 5 s with `ConfigNotFound` (no `url`); a gateway other than
`openshift-ingress/openshift-ai-inference` or `openshift-ingress/maas-default-gateway` is
`RefsInvalid` "Gateway <ns>/<name> does not exist" from 5 s, with no `url`, while the workload
still deploys; a `runtimeImage` or `modelName` (default: the model's `name`) containing `oom` or
`fail` stays at `MinimumReplicasUnavailable` from 20 s for good, as KServe does (it never turns
into `ProgressDeadlineExceeded`; `mock/areas/models.md` has the source lines), so the model
reads `pending` with that reason for good: no condition tells it apart from a slow start; on a
spoke such a model keeps its work `Progressing` and the placed model reads
`pending`/`Processing` for good; the rollout's `progressDeadline` times that cluster out (a
`Progressive` rollout moves on to the next one), which no condition shows; a cluster labelled
`ai-grid-mock/fail-apply=true` (or a comma-separated list of model names) fails to apply the
matching works: a model with no other cluster serving it reads `failed`/`NotAsExpected`, one
served elsewhere `partiallyavailable` (proposal P13), and the work `phase: "failed"`,
`applied: "False"`, `available: "Unknown"`, with
`Applied=False/AppliedManifestWorkFailed` "Failed to apply manifest work" (the manifest's own
text, `Failed to apply manifest: the server doesn't have a resource type "LLMInferenceService"`,
is in the gRPC status only).

## Errors worth building UI for

| Status | How to get it from the fake | Message |
|---|---|---|
| 401 | `AUTH_TOKEN=expired-token` on any `/api/v1` endpoint but `GET /config`: the hub rejects the token in the BFF's provider-admin check (the access review, for `GET /user`). `GET /config` asks neither and answers 200. A request without the token header is 401 on every `/api/v1` path, `/config` included | `the hub rejected the credentials; log in again`, `missing x-forwarded-access-token header` |
| 403 | `viewer-token` on any `/api/v1` request but `GET /user` and `GET /config`: the BFF's provider-admin check refuses it before the backend. The backend's own 403 texts are behind that check until the backend authorizes the caller | `this console is only for provider admins, users who may patch ManagedClusters on the hub, and the hub says you are not one` |
| 404 | a path the BFF has no route for, such as the removed `/api/v1/tenants` | `the requested resource could not be found` |
| 405 | a known `/api/v1` path with a method it has no route for, such as `POST /api/v1/config` | `POST is not allowed on /api/v1/config; use GET, HEAD`, with an `Allow` header |

The full table, including 502 and 504, is in `bff-api.md`, "Errors".

## Deliberate stubs

The fake answers `Unimplemented` for exactly the methods in `intentionallyUnimplemented`
(`bff/internal/fakebackend/fakebackend_test.go`); the test fails when the list and the fake
disagree ([proto/README.md](proto/README.md) explains the allowlist). Today:
`AiGrid/GetCurrentUser` (the BFF derives `isProviderAdmin` from a hub access review instead)
and every method of `CatalogItems`. They are placeholders until the shapes are agreed with the
backend team; the BFF has no endpoint for them yet. The draft has no `Subscriptions` or `Grid`
service any more: the console reads the backend's Subscriptions, and Monitoring is the hub's
Perses.

## Rules

1. Never invent a field. The shapes are the draft proto in `proto/ai_grid/v1/*.proto` and the
   BFF JSON (`docs/plan/bff-api.md`, `bff/internal/api`, `examples/`). A page that needs more
   starts with the proto, the fake and the BFF, not with the UI.
2. No real data in fixtures: `example.com` hosts, documentation IP ranges, invented UUIDs and
   fictional names only. This repository is public.
3. `isProviderAdmin` only decides what to show; the backend enforces every write, so handle
   403 anyway.
4. Do not hard-code what moves: times, `resourceVersion`, work names, scenario state.
5. After changing a fixture or the BFF's JSON, run `make -C bff golden` and review the diff;
   never edit `bff/gen` by hand (`make -C bff generate`, which runs the `bff/go.mod` Go
   toolchain so the output matches CI's `check-generated`).
