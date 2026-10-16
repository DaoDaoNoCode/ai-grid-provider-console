# Developing the console without the backend

This directory is the console's stand-in for everything that will one day come from
`ai-grid-backend` and the hub: fixtures for a fake gRPC backend, the research that says how
the real systems behave, and a plan per area for keeping the fake faithful. Nothing here is
real data. Every name, id, host and number is invented.

## Why this exists

The frontend and the BFF live in this repository. The backend is written by another team
in another repository and lands RPC by RPC. If the console only worked against a real
backend on a real hub, every page would wait for its RPC, every developer would need a
cluster, and every demo would depend on a hub being healthy.

So the console runs against a fake. The point of the fake is not convenience; it is
**faithfulness**. When the real backend arrives, the BFF mapping and the UI must need only
small changes, because the fake already produced the same field names, the same condition
and reason strings, the same error codes and the same timing the hub produces. Anything
the fake invents is a future bug, so nothing in it is invented without a source: every
behaviour comes from a CRD on the dev hub, from upstream controller source, from vendor
documentation, or from the backend's own conventions. The sources are in `research/`.

## Principles

1. **The proto is the contract.** The console imports one generated `ai_grid.v1` package,
   today built from the draft proto in `proto/` (see "The draft proto" below), and the fake
   implements the same services from the same package. `TestFakeImplementsEveryProtoMethod`
   calls every method of every service in that package over an in-memory connection and
   fails on any that answers `Unimplemented`, unless the method is on an explicit allowlist
   of intentional stubs, each with its reason; a listed method that starts answering fails
   the test too, so the list is exactly the set of stubs. It guards against stubs, not
   behaviour; the per-area tests cover behaviour. A second test fails when the draft stops
   being a superset of the backend's real proto, so the fake can never silently fall behind
   the backend and the draft can never silently diverge from it.
2. **Mirror the real objects, not the POC's inventions.** ACM `ManagedCluster`, `Placement`,
   `ManifestWorkReplicaSet`, Keycloak Organizations, KServe `LLMInferenceService`, MaaS
   `MaaSModelRef`, `MaaSSubscription`, `MaaSAuthPolicy`, Kuadrant policies and Praxis grid
   CRDs are what runs on the cluster. The fake carries their fields, phases, condition types
   and reason strings verbatim. Fields the POC invented (`revision`, `status: Saved`,
   `hasDeployment`) do not exist here.
3. **"Not implemented yet" is a normal state.** RPCs that are not agreed yet answer
   `Unimplemented`, exactly as the real server does for a stub. The BFF maps it to 501 and
   the UI shows "not available on this backend yet", so a page can ship before its RPC.
4. **Errors use the same codes the backend will use.** `NotFound`, `AlreadyExists`,
   `InvalidArgument` with the CRD's own validation message, `FailedPrecondition` when the
   hub lacks a feature gate, `Unavailable` when the hub or Keycloak is down, `Unimplemented`
   for stubs. The BFF already maps all of them to HTTP; the UI's error paths are exercised
   against the fake, not discovered in production.
5. **Time passes.** Objects do not appear Ready. They go through the same transitions the
   controllers drive, on timers the fixtures control: a cluster imports in stages, a model
   starts Pending with the real reason strings and becomes Ready, a subscription waits for
   its rate-limit policy to be enforced, a lease expires and a cluster becomes Unknown.
6. **No real data, ever.** Fixtures use `example.com`, invented UUIDs and fictional sites.
   Research notes name field paths and string constants from the real cluster, never its
   hosts, ids or people.

## How to run it

```sh
make install     # once: frontend dependencies
make dev-fake    # fake backend :9090 and hub :9091, BFF :8080, frontend :9000
```

```
browser → Vite :9000 → BFF :8080 → fake ai-grid-backend :9090 (gRPC)
                          └──────→ fake hub API :9091 (SelfSubjectAccessReview)
```

No `oc login`, no cluster. Open http://127.0.0.1:9000. You're signed in as `dev-user`, a provider
admin. To see the console as another kind of user, set `AUTH_TOKEN` to a token from
`fixtures/access.json`. The fake hub decides by token alone; `AUTH_USER` only changes the name in
the masthead:

| Command | You get |
|---|---|
| `make dev-fake` | A provider admin |
| `AUTH_TOKEN=viewer-token AUTH_USER=viewer make dev-fake` | A signed-in user who isn't a provider admin |
| `AUTH_TOKEN=expired-token AUTH_USER=expired make dev-fake` | A rejected token: `/api/v1/user` returns `401` |

To run the pieces separately, use `make dev-fake-backend`, `make dev-bff-fake` and
`make dev-frontend-fake`. `bff/cmd/fake-backend` reads `mock/fixtures` and serves:

- the `ai_grid.v1` gRPC services on `127.0.0.1:9090`, with health and reflection registered
  like the real server, a per-RPC latency that honours cancellation, and every forwarded
  identity header logged;
- the one slice of the Kubernetes API the BFF itself calls, `SelfSubjectAccessReview`, on
  `127.0.0.1:9091`, answering allowed, denied or 401 by token as `fixtures/access.json` says.
  It returns `403` for every other path and does not look at the requested verb or resource,
  so every access check gets the same answer for a given token.

The fake's flags are `--fixtures`, `--listen-address`, `--hub-address` and `--log-level`; run
`go run ./cmd/fake-backend --help` in `bff/` for the full list. `bff/internal/fakebackend` is
the implementation; `bff/internal/backend/backendtest` is its in-memory sibling for Go tests.
Both grow together as RPCs are added.

## The draft proto (`proto/`)

The backend's proto has three RPCs. The areas below need more, so the console carries a
**draft** of the next proto in `proto/ai_grid/v1/`, split by type as the style guide in
`research/backend-conventions.md` section 5 says (`ai_grid.proto`, `condition_type.proto`,
`metadata_type.proto`, `managed_cluster_type.proto`, `managed_clusters_service.proto`,
`tenant_type.proto`, `tenants_service.proto`, and the placeholder services `grid_service.proto`,
`models_service.proto`, `catalog_items_service.proto`, `subscriptions_service.proto`). It is the
console's **proposal** to the backend team, nothing more: the shapes are the ones drafted in
section 6 of that report, every file says so in its header, and the `go_package` is the
console's own (`bff/gen/ai_grid/v1`), not the backend's.

What keeps it honest:

- **The backend's three services are in it unchanged.** `AiGrid/Ping`,
  `ManagedClusters/ListManagedClusters` and `Tenants/ListTenants`, with `ManagedCluster`
  fields 1-3 and `Tenant` fields 1-3 byte-for-byte as the backend defines them. New fields
  and methods are only appended.
- **The backend's real file is vendored.** `proto/upstream/ai_grid.proto` is a copy of
  `proto/ai_grid/v1/ai_grid.proto` from the backend repository at the commit in
  `proto/upstream/COMMIT`. `hack/sync-upstream-proto.sh <ref>` refreshes both;
  `hack/dev-backend.sh` runs the backend at that commit.
- **A test proves the superset.** `bff/internal/protodrift` compiles the vendored file with
  `protocompile` and checks, against the draft's generated descriptors, that every upstream
  service, method (same input and output), message, field (same number, name, cardinality
  and type) and enum value exists. The day the backend changes its proto, the sync script
  plus this test name every difference. `TestFakeImplementsEveryProtoMethod` in
  `bff/internal/fakebackend` then calls every method of every draft service and fails on an
  `Unimplemented` answer, except for the methods listed in `intentionallyUnimplemented`
  (`fakebackend_test.go`), each with its reason: the placeholder `Grid`, `CatalogItems` and
  `Subscriptions` methods until they are agreed with the backend team, and `GetCurrentUser`,
  which the BFF does not need yet (`Models` and `GetHubCapabilities` are implemented and
  probed like every other method). An entry whose
  method starts answering fails the test until the entry is removed, so the allowlist is
  always exactly the set of stubs.
- **Generated code is committed and checked.** `bff/gen/ai_grid/v1` is produced by
  `make -C bff generate` (`buf generate` with `protoc-gen-go` and `protoc-gen-go-grpc` at
  pinned versions, all run through `go run`, so nothing is installed); `make -C bff lint-proto`
  runs `buf lint` (STANDARD minus `SERVICE_SUFFIX`); `make -C bff check-generated` generates
  into a temporary directory and `diff -r`s it against `gen/`, so CI fails on a stale file,
  on a missing one and on one the proto no longer produces, not only on uncommitted edits.

When the backend ships an RPC from the draft, the console bumps the vendored copy, the drift
test confirms the shapes agree (or shows exactly where they do not), and the BFF keeps
working against the real server because the wire format is the same. When the backend has
shipped all of it, the console switches its import from `bff/gen/ai_grid/v1` back to the
backend's generated package, deletes `proto/` and `bff/gen`, and the fake stays as it is.

The Clusters area added, additively, what `research/acm.md`'s richer `ManagedCluster`
proposal needs and the fake now simulates: `taints` (with `time_added`), `generation`,
`finalizers`, `status.state_message`, and the finer `ManagedClusterState` values
(`PENDING_IMPORT`, `IMPORTING`, `IMPORT_FAILED`, `NOT_ACCEPTED`, `UNKNOWN`) with the ACM
console's derivation order documented on the enum. The flattened claim fields and the
`addon_status` map from that proposal were not added: the BFF derives them from
`cluster_claims` and the `feature.open-cluster-management.io/addon-*` labels, which the proto
already carries verbatim.

The Models area filled the placeholder `Models` service (`model_type.proto`,
`models_service.proto`) with `Model { name, metadata, spec, status }`: the spec is the subset
of a KServe `LLMInferenceService` the console writes (`model.uri/name`, `replicas` or
`scaling`, `base_refs`, `runtime`, `router` with gateway refs, a managed route and the
scheduler, the `main` container) plus an ACM `Placement` (one predicate: label selector, claim
expressions, tolerations, `number_of_clusters`, spread constraints) and a `Rollout`
(`All|Progressive|ProgressivePerGroup` with `max_concurrency`, `max_failures`,
`progress_deadline`, `min_success_time`); the status is the LLMInferenceService status of the
hub deployment (`url`, `addresses`, Knative conditions, `applied_configs`, `workloads`,
`observed_generation`), a derived `phase` with its reason and message, and for a placed model
the Placement decisions and conditions plus the ManifestWorkReplicaSet summary, conditions and
one `ManifestWorkStatus` per generated work (conditions, manifests with their conditions and
feedback, generations). The research's `Placements` and `ManifestWorkReplicaSets` services
were not drafted as separate services: the console only ever needs them through a model, so
the `Models` service wraps one Placement and one MWRS per model (`research/acm.md`,
"Proposal"). `AiGrid` gained `GetHubCapabilities` (`manifest_work_replica_set_enabled`,
`observability_installed`, `acm_version`).

The Tenants area removed two drafted fields instead of adding: `Tenant.version` (field 8)
and `UpdateTenantRequest.lock` (field 3) are `reserved`, because Keycloak Organizations have
no server-side version, etag or `Last-Modified` and a Keycloak-backed backend could never
honour them (`research/keycloak.md` 8.1). It added `TenantDomain` and
`repeated TenantDomain domain_details = 9` (`name`, `verified`, `identity_provider_alias`,
`auto_redirect`, the fields Keycloak 26.8 keeps per domain), kept `domains` as the list of
names, and narrowed `ListTenantsRequest.filter` to the one CEL form the backend can push down
to Keycloak's `search`, `this.name.contains("<term>") || this.domains.exists(d, d.contains("<term>"))`.

## Fixtures (`fixtures/`)

| File | Shape | Notes |
|---|---|---|
| `managedclusters.json` | `{"clusters": [ai_grid.v1.ManagedCluster...]}` in protojson | Full hub objects: labels exactly as ACM writes them (`name`, `cloud`, `vendor`, `clusterID`, `openshiftVersion*`, `clusterset=default`, `feature.open-cluster-management.io/addon-*`) plus the console's `ai-grid/*` labels and annotations, `uid`, `resourceVersion`, `creationTimestamp`, finalizers, taints, client configs, and a `status` with every condition's exact type, reason and message, name-sorted claims, capacity (`nvidia.com/gpu` on GPU clusters) and version. One cluster per state the ACM console distinguishes: `local-cluster`, `site-paris-1`, `site-frankfurt-1` ready (Paris enrolled with GPUs, Frankfurt not enrolled); `site-madrid-1` unknown (lease expired, taint `unreachable`, add-ons `unreachable`); `site-ashburn-1` offline (API server down, taint `unavailable`); `site-berlin-1` importing and `site-oslo-1` pending import (`auto-detect` labels, no claims); `site-dublin-1` import failed; `site-lisbon-1` not accepted (`hubAcceptsClient: false`, `HubClusterAdminDenied`); `edge-lyon-2` detaching (`deletionTimestamp`, `Deleting/ResourceRemaining`; the research verified that reason but not its message, which is left empty). `status.state` and `status.stateMessage` are derived by the server on every read and must not be written here. |
| `tenants.json` | `{"tenants": [ai_grid.v1.Tenant...]}` in protojson | Keycloak 26.8 Organizations as the backend maps them: UUID `id`, unique `name` and `alias` (alias defaults to the name and never changes), `enabled`, `description`, `attributes` (first value per key), `domains` as the lower-case names of `domainDetails`, each with `verified`, `identityProviderAlias`, `autoRedirect`. Six fictional organizations: one disabled (`umbrella-biotech`), one with two domains and attributes (`acme-robotics`), one with a wildcard domain (`vandelay-industries`), one without domains (`initech-labs`), one whose alias differs from its name (`globex-research` / `globex`). The fake validates the file like Keycloak would (duplicate name, alias or domain, bad domain, non-v4-UUID id fail at start). Other modes, one at a time: `{"unavailable": "<text>"}` makes every Tenants RPC `Unavailable` (message `Keycloak is unavailable: <text>`; the shipped backend still returns `Unknown` here), `{"realmMissing": true}` makes them `FailedPrecondition` with `Keycloak realm "ai-grid": Realm not found.` (the dev hub today), `{"organizationsDisabled": true}` the same with `Organizations not enabled for this realm.`. |
| `models.json` | `{"models": [ai_grid.v1.Model...], "bindings": {"<namespace>": ["global"]}}` in protojson | The subset of a KServe `LLMInferenceService` the console writes, shaped like the hub instance (`baseRefs`, `model.uri/name`, `replicas`, the `openshift-ai-inference` Gateway, a managed route and the scheduler, a `main` container with resources and env), with `openshift.io/display-name|description` annotations, plus an optional `placement` (an ACM Placement: cluster sets, label selector, tolerations) and `rollout` (strategy, concurrency, deadline). `status` is derived on every read and must not be written here. Five fictional models in `ai-grid-models`: `tiny-llm` Ready on the hub; `granite-8b-instruct` placed on the enrolled and provisioned sites with the rollout complete (`site-paris-1` today, `site-madrid-1` joins when its lease recovers); `mistral-7b-instruct`, a Progressive rollout one OpenShift spoke at a time, without `creationTimestamp` so it is created when the fake starts and can be watched live (`site-frankfurt-1`, `site-berlin-1` once it joins, `site-paris-1`); `llama-3-70b` failed on a preset the hub lacks (`ConfigNotFound` with KServe's exact message); `codellama-13b`, whose placement selects no cluster (`NoManagedClusterMatched`, `PlacementDecisionEmpty`). `bindings` names the ManagedClusterSets bound into a model namespace (`global` when not listed; an empty list is a namespace without a binding, `NoManagedClusterSetBindings`). |
| `presets.json` | `{"namespace", "presets": [...]}` | The `LLMInferenceServiceConfig` presets installed in the RHOAI applications namespace (`v3-6-0-kserve-config-llm-*`, the subset the research names), which `baseRefs` resolve against; an unknown one is accepted by the API server and fails later with `PresetsCombined=False/ConfigNotFound`, as on the hub. |
| `access.json` | who is a provider admin | Drives the fake hub's access review **and** the fake backend's answer to a mutating RPC: a token in `deniedTokens` (or any token when `defaultAllowed` is false) gets `PermissionDenied` with the API server's forbidden message from `UpdateManagedCluster` and with "is not a provider admin" from `CreateTenant`, `UpdateTenant` and `DeleteTenant`, a token in `rejectedTokens` gets `Unauthenticated` from every RPC, reads included, like an expired OpenShift token at the hub; so `AUTH_TOKEN=viewer-token` sees the clusters and tenants but cannot enrol a cluster or create a tenant (the BFF answers 403 and the UI hides the actions) and `AUTH_TOKEN=expired-token` sees nothing but the signed-out path. |
| `settings.json` | latency, speed, hub capabilities | `latency` is a Go duration such as `"40ms"` added to every RPC; a hub list from a pod on the hub takes tens of milliseconds. `speed` multiplies the scenario clock and the model lifecycles (`10` plays the five-minute scenario in 30 seconds; default `1`). `manifestWorkReplicaSetEnabled` (default true) is what `GetHubCapabilities` reports and what gates a placed model; `false` mirrors the dev hub, where the CRD exists but nothing reconciles it, so `CreateModel` with a placement is `FailedPrecondition` and a seeded placed model keeps an empty MWRS status. `observabilityInstalled` and `acmVersion` are reported as-is. |

Fixtures are protojson so they use the field names grpcurl shows and fail to load on any
unknown field; a fixture that fails to load stops the fake with an error, so a typo never
serves nonsense. A missing file leaves its part empty, except `access.json`: without it every
token is a provider admin. The directory itself must exist. Tests load the shipped directory
and check the ACM labels, that every condition uses only a type, reason and message the
research verified, that claims are sorted, that hub taints match the Available condition, that
each cluster derives the state it was seeded for, that the tenants are a realm Keycloak would
accept and cover the shapes the UI renders, and that every model uses only installed presets
(but the one seeded to fail), the hub's Gateways, the selector and toleration operators, the
built-in cluster sets and the rollout strategies, and derives the phase it was seeded for.
Fixture names, labels and ids must never be real: this repository is public. The
addresses the fake derives are synthetic too: external URLs under `example.com` and
internal ones as standard Kubernetes service names (`<svc>.<ns>.svc.cluster.local`) built
from the fictional Gateway names.

## What the research found, in one paragraph each

The full reports are in `research/`. Read them before changing a fixture or adding a
simulated behaviour; they cite the CRD path or source file for every string.

**ACM hub** (`research/acm.md`). A `ManagedCluster`'s health is five conditions with fixed
reason strings, written by three controllers; the ACM console derives
`pendingimport | importing | importfailed | ready | offline | unknown | detaching | notaccepted`
from them, and the fake will do the same. ACM auto-labels every imported cluster; the hub
adds `unreachable`/`unavailable` taints that Placements must tolerate. Placements only see
cluster sets bound into their namespace, write `PlacementDecision`s named
`<placement>-decision-<n>` sorted by cluster name, and recompute within seconds when labels
change. `ManifestWorkReplicaSet` fans one `ManifestWork` per selected cluster with
`Applied`/`Available` and rule-driven `Progressing`/`Degraded` conditions and a summary. On
the dev hub the MWRS feature gate is off: the CRD accepts objects that nothing reconciles,
so the backend must detect that and answer `FailedPrecondition`.

**Keycloak tenants** (`research/keycloak.md`). The hub runs Keycloak 26.8 with Organizations
available but no `ai-grid` realm. The Organizations admin API lists by name with offset
paging (default page 10), returns 201 plus a `Location` header on create, replaces the whole
representation on update, enforces unique `name`, `alias` and domains with exact 409 and 400
messages, and needs `view-organizations` to return anything (`query-organizations` alone
yields an empty list). The backend today logs in as the master realm admin with a password
grant on every call and returns every failure as `Unknown`. The report proposes the
`Tenants` CRUD proto, the gRPC code for each Keycloak outcome, and the bootstrap steps for a
realm plus a scoped service-account client.

**Models, MaaS, Kuadrant, Praxis** (`research/models-maas.md`). Models are KServe
`LLMInferenceService` (v1alpha2) with Knative-style conditions; there is no phase, so
Pending/Ready/Failed is derived from `Ready`, and the reason strings on failure are known.
MaaS entitlement is a dual check: `MaaSAuthPolicy` grants access by group, `MaaSSubscription`
sets quota per model; a `MaaSModelRef` stays `Pending/NoPairingFound` until both reference
it, and each subscription materialises a Kuadrant `TokenRateLimitPolicy`. On the hub the
model MaaS serves is an `ExternalModel` pointing at the Praxis grid gateway, not a local
model. Praxis grid CRDs are documented but not installed; their phase machines are in the
report. API keys live in `maas-api`, not in a CRD. The POC stores CR-shaped JSON in Git and
does not use ConfigMaps for the catalog.

**Observability** (`research/observability.md`). The fleet Thanos behind ACM's
`rbac-query-proxy` is the right endpoint and labels every series with `cluster=<ManagedCluster
name>`. AI metrics reach it through RHOAI's OpenTelemetry collector at a 300 second cadence,
so rate windows must be 15 minutes or more. vLLM metrics with `model_name` are real and
fleet-visible today. The gateway request, error and latency metrics the POC assumed do not
exist; Istio ones are wired but empty, and GPU utilisation arrives divided by 100. No metric
carries a tenant label yet, so per-tenant usage is `unavailable` until a Kuadrant
`TelemetryPolicy` or the Praxis metering service exists. The POC's overview JSON and its
deterministic demo generator are transcribed so the fake reproduces them sample for sample.

**Backend conventions** (`research/backend-conventions.md`). The backend is a single-file
proto with three RPCs, generated code committed by hand, no interceptors and errors returned
as plain Go errors. It says it is aligned with OSAC, whose conventions are precise:
`List/Get/Create/Update/Delete`, offset and limit paging with `size` and `total`, CEL
filters, field masks with optimistic locking, `id/metadata/spec/status` objects, a shared
condition type, and a fixed gRPC error table. The report proposes a style guide that keeps
the shipped method names, drafts the next proto files in that style, and describes the
two-repository workflow: proto first with `Unimplemented` stubs, tag, console bumps, fake
implements, nightly drift build.

## Plan per area

Each area lists what the fake will simulate, what the frontend builds against it, and what
the backend has to agree to. Field names and strings are in the research; this is the order
of work.

### 1. Clusters (ACM ManagedCluster)

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
Frontend: status labels per state, GPU column, console link, enrol and remove per row for
provider admins only (hidden otherwise); the browser mock mirrors the fixture file and a test
keeps the two in step.
Remaining here: location and coordinate editing in the UI (the PATCH exists) and the map
(area 5). Placement recomputation and ManifestWorkReplicaSet belong to area 3.
Backend ask: ship the draft's `GetManagedCluster`, `UpdateManagedCluster` and richer
message (`proto/ai_grid/v1/managed_cluster*.proto`), with the state derived server-side.

### 2. Tenants (Keycloak Organizations)

Implemented. Fake (`bff/internal/fakebackend/{keycloak.go,tenants.go}`): an in-memory
organization store keyed by UUID v4 that answers like the backend's mapping of Keycloak 26.8
(`research/keycloak.md` 3, 5, 8). `CreateTenant` checks in Keycloak's order: an explicit
alias with whitespace or an RFC 3986 reserved character ("Empty Space not allowed." /
"Character '/' not allowed."), a blank name ("Name can not be null"), the alias defaulting to
the name ("Name cannot be used as alias: ..."), a taken name or alias (`AlreadyExists`, "A
organization with the same name already exists." / "...same alias already exists"), then the
domains with `Organizations.validateDomain`'s messages, lower-cased, unique across the realm
("Domain X is already linked to organization Y in realm ai-grid"); `enabled` is stored as
sent. Domain names are trimmed and lower-cased before validation, as `OrganizationDomainModel`
does, so messages print the canonical form; the wildcard "parts" messages print the base
without `*.`, and a `*` not followed by a dot is an ordinary e-mail-domain character
(`*acme.example.com` is accepted). The e-mail-domain rule is hibernate's pattern with two
documented approximations (length caps on raw characters instead of punycode, no IPv6
literal). `UpdateTenant` is the backend's GET, merge, PUT: mask paths `name`, `domains`,
`enabled`, `description`, `attributes`, `domain_details` replace the field as a whole (the
`domains` path keeps the metadata of a domain that stays); without a mask the scalars are
replaced (`enabled` to true when unset, Keycloak's default) and `attributes` and the domains
left alone, which is what a Keycloak PUT does with a body that lacks those keys; a different
alias is "Cannot change the alias", a new name that matches another organization's name or
any organization's domain, its own included, is `AlreadyExists` (Keycloak's exact search
matches both and does not exclude the organization itself). `ListTenants` orders by name
(byte order, an approximation of the realm database's collation), pages with `offset`/`limit`
(`total` from the whole search like `/count`), includes disabled organizations and evaluates
the one filter form `this.name.contains("<term>") || this.domains.exists(d, d.contains("<term>"))`,
the expression that means what Keycloak's `search` does (contains on name or any domain). `Get`
and `Delete` answer `NotFound` with the conventions' message and log Keycloak's "Organization
not found.". Everything Keycloak would decide is answered only after the Keycloak gate, so
with Keycloak unreachable a bad domain is `Unavailable`, as it would be from the real backend.
Mutations are gated by the provider-admin rule of `access.json` (`PermissionDenied`); every
RPC needs `authorization`. `tenants.json` selects the three failure modes (`unavailable`,
`realmMissing`, `organizationsDisabled`); latency applies.
Invented here, because nothing in Keycloak or the conventions fixes a text, and proposed to
the backend in `research/keycloak.md` 8.2 so they become the contract: the `PermissionDenied`
message ("User ... is not a provider admin: ..."), the `FailedPrecondition` wrapper
(`Keycloak realm "ai-grid": ` before Keycloak's text), the `Unavailable` prefix, the
request-shape messages ("object is required", "id is required", "object.id must be empty"; the
draft rejects a client id that Keycloak would ignore) and "domains and domain_details name
different domains". The UI only displays them.
BFF: `GET /api/v1/tenants?offset=&limit=&search=` with a `meta` page, `GET/PATCH/DELETE
/api/v1/tenants/{id}`, `POST /api/v1/tenants` (201 + Location); Keycloak's messages reach the
UI as 422 and 409; an absent `enabled` from today's backend (fields 1-3 only) reads as enabled.
Frontend: list with search, paging, name/alias/domains/enabled columns, create and edit modal
(alias read-only on edit) that shows the server's validation message, enable/disable and
delete with confirmation for provider admins only; the browser mock applies the same rules
and mirrors the fixture file, with a test that keeps them in step.
Remaining here: members (list, add, remove, invite; the draft has no member RPCs yet, open
question 3 in `research/keycloak.md`), the realm and service-account bootstrap (section 9),
attribute editing in the UI (the PATCH exists), and the `exact` search form.
Backend ask: the `Tenants` CRUD proto as now drafted in `proto/ai_grid/v1/tenant*.proto`
(without `version`/`lock`, with `domain_details` and `optional bool enabled`), keyed by `id`;
the gRPC code table and the proposed message texts in `research/keycloak.md` 8.2 (today every
failure is `Unknown`); reading both Keycloak error body shapes (`errorMessage` and `error`);
a scoped service-account client instead of the master admin.

### 3. Models (LLMInferenceService, Placement, ManifestWorkReplicaSet)

Implemented. Fake (`bff/internal/fakebackend/{models.go,kserve.go,placement.go,work.go}`): a
store of models whose desired state is a KServe `LLMInferenceService` spec, optionally with an
ACM `Placement` and a `ManifestWorkReplicaSet` (both `model-<name>` in the model's namespace,
labelled `ai-grid/model=<name>`); the store keeps only what the controllers would have written
(when a model was created, when each generated work was applied) and derives everything else
on every read from the clock and the current clusters.
`CreateModel` admits like the API server and the KServe webhook (`research/models-maas.md`
2.1, plus the CRD's CEL texts read from the hub): a DNS-1123 subdomain name and a DNS-1123
label namespace with apimachinery's messages, `spec.model.uri` with a known scheme, the four
`scaling` rules verbatim ("replicas and scaling are mutually exclusive; use scaling for
autoscaled deployments or replicas for static deployments", "either wva or keda must be
specified when scaling is configured", "at least one trigger is required when using direct
KEDA scaling", "minReplicas cannot exceed maxReplicas"), the Placement operators and cluster
sets, the rollout durations and percentages; `AlreadyExists` with the API server's message; and,
before writing an MWRS, `FailedPrecondition` "ManifestWorkReplicaSet feature gate disabled on
hub" when `settings.json` turns the gate off. The object comes back with no conditions. Then
the lifecycle of 8.2 replays on the scenario clock, each write stamped at the time it
happened so `lastTransitionTime` moves only on a status change: T1 (5 s) `PresetsCombined`,
`GatewaysReady`, `HTTPRoutesReady=False/WaitingForGateway` ("The following HTTPRoutes exist
but no Gateway controller has accepted them yet: [<ns>/<name>-kserve-route]", the reason
KServe's router reports for a managed route; `HTTPRouteNotObserved` "The managed HTTPRoute
has not been observed yet" is only reported for an inline route spec, which the console does
not write) and `appliedConfigs` (the implicit scheduler, router-route and template presets,
then the `baseRefs` as `UserRef`); T2 (15 s) the route, pool and scheduler ready,
`MainWorkloadReady=False/Progressing` with an empty message, `workloads` (`<name>-kserve`,
`<name>-kserve-router-scheduler`, the `<name>-kserve-workload-svc` Service); T2b (20 s)
`MinimumReplicasUnavailable` "Deployment does not have minimum availability."; T3 (45 s)
everything True, `url`, the six addresses (external and internal root, path and publishers
forms with their `models[]`), `workloads.primary.readyReplicas`. The roll-ups copy the first
failing dependent's reason and message as Knative does, so `Ready` reads
False/`WaitingForGateway`, then `Progressing`, then `MinimumReplicasUnavailable` while a
healthy model starts (the UI shows these as "Starting").
Failure modes: an unknown `baseRef` stops at T1 with `ConfigNotFound` and KServe's exact
message (`LLMInferenceServiceConfig "<name>" not found in namespaces [<ns> <apps-ns>]`); an
image or model name containing `oom` or `fail` stays at `MinimumReplicasUnavailable` and
turns into `ProgressDeadlineExceeded` with the Deployment's message after the default
600 s progress deadline; a Gateway outside `openshift-ingress/{openshift-ai-inference,
maas-default-gateway}` gives `GatewaysNotReady` ("The following Gateways are not ready:
[<ns>/<name>]") and `HTTPRoutesReady=False/WaitingForGateway`. A spec change bumps the
generation and the Deployment rolls out again from `Progressing`.
Placement decisions are recomputed from the clusters on every read (`research/acm.md` 3,
items 6 and 7): the sets bound into the namespace (`global` = every cluster, `default` = the
`clusterset=default` label; `models.json` can unbind a namespace), the predicate (AND of
`matchLabels`, `matchExpressions` with Kubernetes `In|NotIn|Exists|DoesNotExist` semantics
and claim expressions), `NoSelect` taints dropped unless tolerated (key, value for `Equal`,
effect, `tolerationSeconds` counted from `timeAdded`), terminating clusters never selected,
cluster-name order, `numberOfClusters` cap, and `PlacementSatisfied` with the exact reasons
and messages (`AllDecisionsScheduled`, `NotAllDecisionsScheduled` "<n> cluster decisions
unscheduled", `NoManagedClusterMatched`, `NoManagedClusterSetBindings`, `NoIntersection`,
`AllManagedClusterSetsEmpty`) and `PlacementMisconfigured=False/Succeedconfigured` always.
The MWRS (`research/acm.md` 4, items 8-13): one work per selected cluster named
`model-<name>-<5 chars from the generateName alphabet>`; `All` applies every cluster at once,
`Progressive` (and `ProgressivePerGroup`, one decision group) fills `maxConcurrency` slots in
cluster-name order, a slot held while the work is to apply, progressing or failed and for
`minSuccessTime` after it succeeded; a failed cluster counts towards `maxFailures` at once and
a progressing or failed one past `progressDeadline` times out, frees its slot and counts too,
after which nothing more is applied (sdk-go `progressivePerCluster`); a `ToApply` cluster (no
work yet, or a work whose `Applied` is not True or whose `Progressing` is missing) never
times out, so it holds its slot indefinitely and the rollout stalls on it, as on the hub (a
dead cluster is a Placement decision to make, not a rollout-engine one); the fake computes the
exact instant a slot frees so timing does not depend on polling. Only the spoke agent writes
a work's status, so a cluster that is not Available has a work with an empty status (no
conditions, no manifests), counted `ToApply` for as long as the agent is silent. From the
moment the agent reports: `Applied=True/AppliedManifestWorkComplete` at once, `Available`
absent until the status controller's first sync 2 s later, then `True/ResourcesAvailable`;
two manifests (the namespace and the LLMInferenceService)
with `Applied`, `Available`, `StatusFeedbackSynced` (`NoStatusFeedbackSynced` for the
namespace); the template's CEL rules evaluated against the spoke object's own lifecycle,
`Progressing=True` until its `Ready` is True and `Degraded=True` when `Ready` is False with
a terminal reason, with reason `ConditionRuleEvaluated` per manifest and
`ConditionRulesAggregated` on the work (the single rule-bearing manifest's message copied;
"Aggregated from <n> manifest conditions" otherwise); feedback `ready` ("False" then "True")
and `url`; every condition stamped with the work's `observedGeneration`. A cluster labelled
`ai-grid-mock/fail-apply=true` gets `Applied=False/AppliedManifestWorkFailed`, the manifest
`AppliedManifestFailed` "Failed to apply manifest: no matches for kind ..." and
`Available=False/ResourcesNotAvailable`; the status controller skips the feedback and the
condition rules of a manifest it cannot find, so no `Progressing` or `Degraded` exists and
the cluster stays `ToApply`, holding its slot without a timeout. The summary counts works per
condition and `updated` per generation;
`PlacementVerified` (`AsExpected` / `PlacementDecisionEmpty`), `PlacementRolledOut`
(`Complete` only when every selected cluster's work is `Applied=True` and `Progressing=False`
at the current generation, else `Progressing`) and `ManifestworkApplied` (`AsExpected`,
`Processing`, `NotAsExpected`, `PlacementDecisionEmpty`) follow the controller's rules. A
template change re-applies the works at the new generation; a cluster leaving the decision
loses its work; `DeleteModel` removes the model at once (the console's MWRS uses the CRD
default cascade `Background`: the finalize reconciler deletes the works and drops the
finalizer in one pass, so the MWRS is gone immediately and the works drain in the cluster
namespaces out of sight; only `Foreground` would keep it listed), and answers
`FailedPrecondition` through a `referencedBy` hook that area 4 will wire to the catalog and
subscriptions (nothing references a model today). `GetHubCapabilities` answers
from `settings.json`. Mutations are gated by the provider-admin rule; every RPC needs
`authorization`; `ListModels` evaluates `this.metadata.namespace == "x"` and
`this.metadata.labels["k"] == "v"` joined with `&&`.
Deviations, documented in the code: the Degraded rule in the console's template fires only
on terminal `Ready=False` reasons (`ConfigNotFound`, `GatewaysNotReady`,
`ProgressDeadlineExceeded`), not on the transient ones KServe reports while starting, or
every rollout would read degraded for its first 45 s (the rule text is in `kserve.go`, the
template's contract); the derived phase of a placed model reads `NotAsExpected` without a
degraded or unapplied work as PENDING, because OCM reports `NotAsExpected` for a work whose
`Available` is simply not True yet; MWRS and Placement condition times are the time the fake
noticed a change, at most one poll
late (the real controller is event-driven with requeues), while every LLMInferenceService
and ManifestWork time is exact; the `apierror` name marker (`ReconcileSingleNodeWorkloadError`)
is deferred: its message is the free-form `err.Error()` of the failed Deployment write, so
any plausible API-server error would do. The hub and source checks of the Models-area review
(the CRD texts, the route messages, the scheduler Deployment name, the empty status of an
unreported work, the absent `Available` before the first sync, the rollout timeout rules and
the Background delete) are recorded in `research/models-maas.md` 2.1/8.2/10 and
`research/acm.md` 4 and items 9, 11, 13 of its proposal, so the research, this plan and the
fake agree.
BFF: `GET /api/v1/models?namespace=&label=`, `GET/PATCH/DELETE /api/v1/models/{namespace}/{name}`,
`POST /api/v1/models` (201 + Location) and `GET /api/v1/capabilities` (501 against today's
backend), with the JSON shape in `docs/plan/bff-api.md`: the POC's `ManagedModel` without
its inventions, plus `placement` (selector, selected clusters, `PlacementSatisfied`) and
`rollout` (strategy, summary, per-site works with their condition statuses and the `ready`
and `url` feedback); PATCH is a locked read-modify-write with the present fields as the mask.
Frontend: a Models page with phase labels (Ready, Starting for KServe's transient
`Ready=False` reasons, Failed with the reason, Pending), replicas, "applied / selected sites"
and URL columns, expandable rows with the conditions or the placement decision and the
per-site works, a deploy modal with the POC's inputs (name, namespace, display name, model
URI and name, image, preset, replicas, CPU, memory, GPUs, hub or sites by `location` label
from the Ready enrolled clusters, All or Progressive rollout), Edit replicas and Delete for
provider admins, and a banner when the capabilities say the MWRS gate is off (the placement
option is then disabled; a 501 from a backend without the RPC says nothing). The browser mock
mirrors the fixture file (a test keeps them in step) and applies the admission rules and the
gate.
Remaining here: editing the placement, env and image in the UI (the PATCH exists), scaling
(`keda` triggers) and multi-node specs in the deploy form, `ProgressivePerGroup` with several
decision groups, the `apierror` failure mode, `status.router` in the proto, and the catalog
reference check once area 4 exists.
Backend ask: the `Models` service and `Model` message as drafted in
`proto/ai_grid/v1/model*.proto`, with the phase derived server-side; `AiGrid/GetHubCapabilities`;
the ManifestWorkReplicaSet feature gate on the hub (`research/acm.md` open question 1).

### 4. Catalog and subscriptions (MaaSModelRef, MaaSSubscription, MaaSAuthPolicy)

Fake: a catalog entry starts `Pending/NoPairingFound` and becomes `Ready` only once an
`Active` subscription and an auth policy reference it, turns `Unhealthy` when its model
fails; a subscription validates the CRD rules (`tokenRateLimits` or `unlimited`, window
regex, limit range), starts `Pending`, flips to `Active` when its generated
`TokenRateLimitPolicy` is enforced, and optionally creates its `<name>-policy` auth policy
with the same description annotation the hub uses. The pairing of subscription and auth
policy is a mode switch, because the product decision on whether they are mirrored or
managed separately is still open.
Frontend: subscriptions table keyed on phase, create and edit with per-model quotas,
tenant linkage through `tokenMetadata.organizationId`, a visible consistency check between a
subscription's owners and the auth policies that cover its models.
Backend ask: the `Catalog` and `Subscriptions` services in `research/models-maas.md`
section 8.1, and a decision on the subscription and auth policy pairing.

### 5. Grid overview and monitoring (Thanos)

Fake: the POC's `GetOverview` contract with the four metric series, per-metric status
(`ok`, `no-data`, `unavailable`, `not-configured`), the deterministic demo generator ported
verbatim so browser mock and fake agree, 300 second sample cadence when emulating the fleet,
clusters that are not Ready emitting nothing, and a fake Thanos HTTP server that reproduces
the observed error cases (JSON `bad_data`, plain-text resolution error, 302 on a bad token,
warnings, more than one series). Per-model usage from the vLLM metric names that exist;
per-tenant usage `unavailable` until the platform has a tenant label.
Frontend: map and monitoring pages with a simulation banner driven by `metricsSource`, charts
that show gaps rather than zeros.
Backend ask: the `Grid` RPCs and PromQL in `research/observability.md`, the fleet endpoint
and credential choice, and the two gateway and tenant-label questions listed there.

### 6. Grid network (Praxis CRDs)

Fake: default to "CRDs not installed" with the `AIGateway` condition the hub shows; a flag
flips to a network with one local site stuck `Pending/AwaitingDiscovery`, remote sites
cycling through the documented phases, and one `InferenceProvider` per Ready model with the
values the ODH bridge writes.
Frontend: a grid topology view that renders the not-installed state as information.
Backend ask: `Grid/GetNetwork` once the CRDs ship through the AI Gateway component.

## Working in parallel with the backend team

1. **Proto first.** A new RPC starts in the console's draft (`proto/ai_grid/v1`), proposed
   to the backend as a PR that touches only its `proto/` and `gen/`; the embedded
   `Unimplemented*Server` makes it compile and answer `Unimplemented`. Both teams review the
   shape. On merge the backend tags a version.
2. **Console syncs and the fake follows.** The console runs `hack/sync-upstream-proto.sh`,
   the drift test shows where the shipped shape differs from the draft and the draft is
   reconciled, the fake gains the behaviour from the research, the BFF handler lands, the
   page switches from mock to real types. Each step is a small PR.
3. **Stubs are fine in production.** A deployed console in front of a backend that lacks an
   RPC shows "not available yet" on that page and works everywhere else.
4. **Drift is caught nightly.** `.github/workflows/drift.yaml` runs every night (and on
   demand) on a throwaway checkout: `hack/sync-upstream-proto.sh main`, then the drift test.
   Nothing is committed; a red run means the backend changed its proto, and the fix is to
   run the sync locally, reconcile the draft and commit both. CI on pull requests tests the
   draft against the vendored copy only, so a backend change that lands between syncs
   shows up in the nightly run, not in the pull request.
5. **The research is the shared source.** When the backend team implements an area, the
   report for that area is the specification both sides test against; disagreements go into
   the report's open questions and are resolved there before code.

## Open questions that affect the mock

- Subscription and auth policy: mirrored one-to-one by the provider console, or managed
  separately? The fake supports both; the UI differs.
- Which Keycloak realm holds tenants: a new `ai-grid` realm, or the organization-enabled
  realm the hub already imports?
- Will the backend act as the caller on the hub (so hub RBAC decides) or validate tokens
  and apply its own policy? This decides what `GetCurrentUser.is_provider_admin` means.
- Method naming: keep `ListManagedClusters` or move to OSAC's bare `List` while the console
  is the only consumer?
- Field masks on maps: whole-map replacement or per-key paths for a single label toggle?
- Which gateway carries AI Grid traffic, and who adds the tenant label to metrics?
- Can the MWRS feature gate be enabled on an MCE-owned `ClusterManager` without being
  reverted?

The complete lists, with context, are at the end of each report in `research/`.
