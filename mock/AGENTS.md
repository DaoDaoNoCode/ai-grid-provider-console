# Building UI against the fake backend

The entry point for a coding agent (or a person) building console pages against the fake
`ai-grid-backend`. It says what runs, what the BFF answers and what the fixtures seed, and
points to the detail:

| For | Read |
|---|---|
| Every endpoint, JSON shape, body rule and error mapping | [docs/plan/bff-api.md](../docs/plan/bff-api.md) |
| The draft proto the BFF and the fake compile against, and the deliberate stubs | [proto/README.md](proto/README.md) |
| The fixture files and what each one seeds | [fixtures/README.md](fixtures/README.md) |
| What the fake and the BFF implement per area, deviations, invented texts, what remains | [areas/clusters.md](areas/clusters.md), [areas/tenants.md](areas/tenants.md), [areas/models.md](areas/models.md) |
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
| `viewer-token` (`AUTH_USER=viewer`) | signed in, not a provider admin: reads work; a write that reaches the backend is 403 (see "Errors" for the exceptions) |
| `expired-token` | rejected by the hub and the backend: 401 from every endpoint but `/api/v1/config` (see "Errors") |

Without the frontend, call the BFF directly:

```sh
curl -s -H 'x-forwarded-access-token: dev-token' -H 'x-forwarded-user: dev-user' \
  http://127.0.0.1:8080/api/v1/clusters
```

Run the pieces separately with `make dev-fake-backend`, `make dev-bff-fake` and
`make dev-frontend-fake`.

The fake backend (`bff/cmd/fake-backend`) serves the backend's gRPC services from
`fixtures/` and answers the BFF's access review like a hub would. Its gRPC services need
`authorization` metadata like the real backend; the BFF forwards it from the proxy headers.
Edit the fixtures and restart to change the fleet, the tenants or the models: `tenants.json`
can reproduce a Keycloak that is unreachable or has no `ai-grid` realm, and
`manifestWorkReplicaSetEnabled: false` in `settings.json` mirrors the dev hub, where a
multi-site placement is refused with 412 and `GET /api/v1/capabilities` reports the gate as
off. The fake moves clusters and models over time (see "Timed scenarios").

## The HTTP contract

[docs/plan/bff-api.md](../docs/plan/bff-api.md) is the contract: every endpoint, the JSON
shapes with examples, the body rules and the error table. The BFF's structs in
`bff/internal/api/*.go` are what it encodes. Every success is `{"data": ...}`; a paged list
adds `"meta": {"size", "total", "offset", "limit"}`; every error is
`{"error": {"code": "<status>", "message": "..."}}`; `DELETE` answers 204 with no body. All
paths need the identity headers.

| Method | Path | Request body | Response `data` |
|---|---|---|---|
| GET | `/api/v1/user` | | `{username, email?, groups, isProviderAdmin}` |
| GET | `/api/v1/config` | | `{gridEndpoint, mapTileUrl, billingUrl, version}` |
| GET | `/api/v1/clusters` | | `GridCluster[]` by name |
| GET | `/api/v1/clusters/{name}` | | `GridCluster` |
| PATCH | `/api/v1/clusters/{name}` | `{aiGridEnabled?, provisioned?, location?, site?, region?, siteName?, latitude?, longitude?}` | `GridCluster` after the write |
| GET | `/api/v1/tenants?offset=&limit=&search=` | | `Tenant[]` by name, plus `meta` |
| GET | `/api/v1/tenants/{id}` | | `Tenant` |
| POST | `/api/v1/tenants` | `{name, alias?, description?, enabled?, domains?, attributes?}` | 201, `Tenant`, `Location` header |
| PATCH | `/api/v1/tenants/{id}` | `{name?, description?, enabled?, domains?, attributes?, alias?}` (alias must be unchanged) | `Tenant` after the write |
| DELETE | `/api/v1/tenants/{id}` | | 204 |
| GET | `/api/v1/models?namespace=&label=k=v&offset=&limit=` | | `Model[]` by namespace and name, plus `meta` |
| GET | `/api/v1/models/{namespace}/{name}` | | `Model` |
| POST | `/api/v1/models` | `{name, namespace, modelUri, displayName?, description?, modelName?, runtimeImage?, runtime?, replicas? or scaling?, baseRefs?, cpu?, memory?, gpuCount?, env?, gateway?, placement?, rollout?, labels?, annotations?}` | 201, `Model` with no conditions yet, `Location` header |
| PATCH | `/api/v1/models/{namespace}/{name}` | `{replicas?, runtimeImage?, env?, placement? (null removes it), rollout?, labels?, annotations?, displayName?, description?}` | `Model` after the write |
| DELETE | `/api/v1/models/{namespace}/{name}` | | 204 |
| GET | `/api/v1/capabilities` | | `{manifestWorkReplicaSetEnabled, observabilityInstalled, acmVersion}` |

Request bodies are exactly one JSON object of at most 1 MiB: `null`, an array or a scalar is
422 (`invalid request body: must be a JSON object`), so are unknown fields, wrong types and
anything after the object, and a larger body is 413. The BFF checks the body before it calls
the hub or the backend. Field semantics (what an absent field, an empty string or `null` inside
the object means) are in `bff-api.md`. A PATCH whose body sets no field (`{}`, or for a tenant
only its unchanged `alias`) writes nothing: it reads the object and answers it with 200, which
also holds for `viewer-token`. A PATCH that sets a field writes, even when the value is the
current one.

## Golden responses (`examples/`)

What the BFF returns for the shipped fixtures at scenario time zero, one file per request:
`{"request", "requestBody"?, "token", "user", "status", "body"}`, with `body` exactly as the
BFF encoded it.

| File | Request |
|---|---|
| `get-user.json` | `GET /api/v1/user` as `dev-user` |
| `get-config.json` | `GET /api/v1/config` (every setting at its default) |
| `get-clusters.json` | `GET /api/v1/clusters`, all ten clusters |
| `get-cluster.json` | `GET /api/v1/clusters/site-paris-1` |
| `get-tenants.json` | `GET /api/v1/tenants`, all six tenants with `meta` |
| `get-tenant.json` | `GET /api/v1/tenants/{id}` for `acme-robotics` |
| `get-models.json` | `GET /api/v1/models`, all five models with `meta` |
| `get-model.json` | `GET /api/v1/models/ai-grid-models/mistral-7b-instruct`, a placed model on two sites mid-rollout |
| `get-capabilities.json` | `GET /api/v1/capabilities` |
| `error-401-expired-token.json` | `GET /api/v1/user` with `expired-token` |
| `error-403-viewer-patch.json` | `PATCH /api/v1/clusters/site-frankfurt-1` with `viewer-token` |
| `error-404-unknown-cluster.json` | `GET /api/v1/clusters/site-unknown-1` |

They are produced by `bff/internal/examples/golden_test.go`: the fake backend loaded from
`fixtures/` over an in-memory gRPC connection with its clock frozen at
2026-10-15T12:00:00Z, no latency, deterministic tenant ids and work names (`g0001`, ...), the
fake hub over `httptest`, and the real BFF handler. `go test ./...` (and so CI) fails when a
file no longer matches. After changing a fixture or the BFF's JSON, regenerate and review the
diff:

```sh
make -C bff golden    # go test -count=1 ./internal/examples -run Golden -update
```

The running fake differs from the files only in what moves: times, `resourceVersion`, the
scenario state, and work names, which get a random five-character suffix. Never hard-code
those.

## What the fixtures seed (`fixtures/`)

The summary below is what a page needs; [fixtures/README.md](fixtures/README.md) has every
field, and `areas/*.md` what the fake derives from them.

**Clusters** (`managedclusters.json`), one per state the ACM console shows, as `status`:

| Cluster | `status` | Notes |
|---|---|---|
| `local-cluster` | `ready` | the hub itself |
| `site-paris-1` | `ready` | enrolled and provisioned, 16 GPUs, site name and coordinates |
| `site-frankfurt-1` | `ready` | not enrolled, 8 GPUs |
| `site-madrid-1` | `unknown` | lease expired, `unreachable` taint, add-ons `unreachable`; enrolled and provisioned |
| `site-ashburn-1` | `offline` | API server down, `unavailable` taint |
| `site-berlin-1` | `importing` | no claims yet |
| `site-oslo-1` | `pendingimport` | |
| `site-dublin-1` | `importfailed` | |
| `site-lisbon-1` | `notaccepted` | `hubAcceptsClient: false` |
| `edge-lyon-2` | `detaching` | |

**Tenants** (`tenants.json`): `umbrella-biotech` is disabled; `acme-robotics` has two domains
(one verified with an identity provider) and attributes; `vandelay-industries` has a wildcard
domain (`*.vandelay.example.com`); `initech-labs` has no domains; `globex-research` has the
alias `globex`, different from its name; `wayne-aerospace` is a plain tenant. Replace the file
with `{"unavailable": "<text>"}`, `{"realmMissing": true}` or `{"organizationsDisabled": true}`
for Keycloak's failure modes (503, 412, 412).

**Models** (`models.json`, namespace `ai-grid-models`):

| Model | `phase` at start | What it shows |
|---|---|---|
| `tiny-llm` | `ready` | a hub deployment, no placement |
| `granite-8b-instruct` | `ready` (`Complete`) | placed on enrolled and provisioned sites: `site-paris-1`, and `site-madrid-1` once its lease recovers |
| `mistral-7b-instruct` | `pending` (`NotAsExpected` at 0 s) | created when the fake starts; a Progressive rollout one site at a time to `site-frankfurt-1` and `site-paris-1` (and `site-berlin-1` once it joins) |
| `llama-3-70b` | `failed` (`ConfigNotFound`) | a preset the hub lacks |
| `codellama-13b` | `pending` (`PlacementDecisionEmpty`) | a placement that matches no cluster |

`settings.json` holds `latency` (40ms per RPC), `speed` and the hub capabilities;
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
| 20 s | `site-berlin-1` joins (claims, capacity, version appear) |
| 30 s | `edge-lyon-2` finishes detaching and disappears from the list |
| 70 s | `site-berlin-1` is imported |
| 90 s, 130 s | `site-berlin-1` add-ons become available |
| 300 s | `site-madrid-1` recovers its lease: `unknown` to `ready`, and `granite-8b-instruct` rolls out to it |

A model created with `POST /api/v1/models` (and `mistral-7b-instruct` at start) walks
KServe's conditions, counted from its creation:

| At | `Ready` and what else changes |
|---|---|
| 0 s | no conditions yet |
| 5 s | `False/WaitingForGateway`; presets combined, gateways ready, `appliedConfigs` filled |
| 15 s | `False/Progressing`: route and scheduler ready, the Deployment created, `workloads` listed |
| 20 s | `False/MinimumReplicasUnavailable` |
| 45 s | `True`; `url`, the six addresses and the ready replica count appear |

A hub deployment's `phase` follows `Ready`, so while it starts it reads `failed` with reason
`WaitingForGateway`, `Progressing` or `MinimumReplicasUnavailable`: those three reasons mean
starting, not failed. A placed model's sites follow the same table, counted from the moment
the site's agent reports its work: `Applied` at once, `Available` 2 s later, the spoke ready at
45 s; `Progressive` moves to the next site once the current one is ready and `minSuccessTime`
has passed. Failures on demand: an unknown `baseRefs` entry stops at 5 s with
`ConfigNotFound`; a gateway other than `openshift-ingress/openshift-ai-inference` or
`openshift-ingress/maas-default-gateway` stops at 5 s with `GatewaysNotReady`; an image or
model name containing `oom` or `fail` stays at `MinimumReplicasUnavailable` from 20 s and turns
into `ProgressDeadlineExceeded` 600 s after the workload started progressing at 15 s, that is
615 s after creation; a cluster labelled `ai-grid-mock/fail-apply=true` fails to apply its
work.

## Errors worth building UI for

| Status | How to get it from the fake | Message |
|---|---|---|
| 401 | `AUTH_TOKEN=expired-token` on an endpoint that asks the hub or the backend: `GET /user` (the hub's access review) and every `/clusters`, `/tenants`, `/models` and `/capabilities` endpoint (the backend). `GET /config` asks neither and answers 200; a POST or PATCH with a bad body is 422 or 413 first. A request without the token header is 401 on every `/api/v1` path, `/config` included | `the hub rejected the credentials; log in again` (`/user`), `the AI Grid backend rejected the credentials; log in again` (the others), `missing x-forwarded-access-token header` |
| 403 | `viewer-token` on a request that passes the body checks and reaches a mutating RPC: every POST and DELETE, and a PATCH that sets at least one field. A PATCH of a cluster or model reads it first, so an unknown name is 404 before 403; a PATCH that sets no field is 200 with no write | the backend's text: the API server's `... is forbidden: User "viewer" cannot patch resource "managedclusters" ...` for clusters, `User "viewer" is not a provider admin: ...` for tenants and models |
| 404 | an unknown cluster, tenant or model | `object with identifier '<name>' not found` |
| 409 | a taken tenant name or alias, or model name; a cluster or model that changed between the BFF's read and write | `A organization with the same name already exists.`, `... same alias already exists`, the API server's `... already exists` for a model |
| 412 | `manifestWorkReplicaSetEnabled: false` in `settings.json`, then a model with `placement`; `{"realmMissing": true}` in `tenants.json` | `ManifestWorkReplicaSet feature gate disabled on hub`; `Keycloak realm "ai-grid": Realm not found.` |
| 413 | a body over 1 MiB | |
| 422 | a body the BFF rejects (unknown field, wrong type, out-of-range coordinate, trailing content) or a value the backend rejects | Keycloak's texts (`Name can not be null`, `Invalid domain format: <d>`, `Cannot change the alias`, `Domain <d> is already linked to organization <o> in realm ai-grid`) and the CRD's (`replicas and scaling are mutually exclusive; ...`) |
| 501 | not reachable through today's endpoints on the fake; the shipped backend answers it for every RPC it lacks (models, capabilities, tenant writes) | `the AI Grid backend does not support this operation yet`: show "not available on this backend yet", not an error page |
| 503 | `{"unavailable": "..."}` in `tenants.json`, then any tenants endpoint | `the AI Grid backend is unavailable; try again` |

The full table, including 502 and 504, is in `bff-api.md`, "Errors".

## Deliberate stubs

The fake answers `Unimplemented` for exactly the methods in `intentionallyUnimplemented`
(`bff/internal/fakebackend/fakebackend_test.go`); the test fails when the list and the fake
disagree ([proto/README.md](proto/README.md) explains the allowlist). Today:
`AiGrid/GetCurrentUser` (the BFF derives `isProviderAdmin` from a hub access review instead),
`Grid/GetOverview` and `Grid/GetNetwork`, and every method of `CatalogItems` and
`Subscriptions`. They are placeholders until the shapes are agreed with the backend team; the
BFF has no endpoint for them yet, so the overview, map, catalog and subscriptions pages have
nothing to call.

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
   never edit `bff/gen` by hand (`make -C bff generate`).
