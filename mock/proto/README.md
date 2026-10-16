# The draft proto

The BFF and the fake backend compile against the console's draft of the next `ai_grid.v1`
proto, kept here until the backend ships it. This page says what the draft is, what keeps it
honest against the backend's real proto, which methods the fake deliberately leaves
unimplemented, and how a change moves between the two teams. The style it follows and the
shapes it starts from are in `mock/research/backend-conventions.md` sections 5 and 6
(background reading).

## What it is

The backend's proto has three RPCs. The console needs more than that, so it carries a
**draft** of the next proto in `mock/proto/ai_grid/v1/`, split by type as the style guide in
`mock/research/backend-conventions.md` section 5 says (`ai_grid.proto`, `condition_type.proto`,
`metadata_type.proto`, `managed_cluster_type.proto`, `managed_clusters_service.proto`,
`tenant_type.proto`, `tenants_service.proto`, `model_type.proto`, `models_service.proto`, and the
placeholder services `grid_service.proto`, `catalog_items_service.proto`,
`subscriptions_service.proto`). It is the
console's **proposal** to the backend team, nothing more: the shapes are the ones drafted in
section 6 of that report, every file says so in its header, and the `go_package` is the
console's own (`bff/gen/ai_grid/v1`), not the backend's.

What keeps it honest:

- **The backend's three services are in it unchanged.** `AiGrid/Ping`,
  `ManagedClusters/ListManagedClusters` and `Tenants/ListTenants`, with `ManagedCluster`
  fields 1-3 and `Tenant` fields 1-3 byte-for-byte as the backend defines them. New fields
  and methods are only appended.
- **The backend's real file is vendored.** `mock/proto/upstream/ai_grid.proto` is a copy of
  `proto/ai_grid/v1/ai_grid.proto` from the backend repository at the commit in
  `mock/proto/upstream/COMMIT`. `hack/sync-upstream-proto.sh <ref>` refreshes both;
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
- **The allowlist refines `mock/README.md`.** That page says the test fails on any
  `Unimplemented` answer, which held while the fake was built from the backend's three-RPC
  proto. The draft adds services the backend has not agreed yet, so the test now fails on
  any `Unimplemented` answer except from a method in `intentionallyUnimplemented`.
- **Generated code is committed and checked.** `bff/gen/ai_grid/v1` is produced by
  `make -C bff generate` (`buf generate` with `protoc-gen-go` and `protoc-gen-go-grpc` at
  pinned versions, all run through `go run`, so nothing is installed). Both `generate` and
  `check-generated` run under `GOTOOLCHAIN` set to the `bff/go.mod` version, the one CI's
  `setup-go` installs: protoc-gen-go formats its output with the `go/printer` of the Go that
  builds it, and Go 1.26 rewrites an indented line in a doc comment into a code block where
  1.27 does not, so a generation with another local Go could differ from CI's. (The draft
  avoids indented comment lines for the same reason.) `make -C bff lint-proto`
  runs `buf lint` (STANDARD minus `SERVICE_SUFFIX`); `make -C bff check-generated` generates
  into a temporary directory and `diff -r`s it against `gen/`, so CI fails on a stale file,
  on a missing one and on one the proto no longer produces, not only on uncommitted edits.

When the backend ships an RPC from the draft, the console bumps the vendored copy, the drift
test confirms the shapes agree (or shows exactly where they do not), and the BFF keeps
working against the real server because the wire format is the same. When the backend has
shipped all of it, the console switches its import from `bff/gen/ai_grid/v1` back to the
backend's generated package, deletes `mock/proto/` and `bff/gen`, and the fake stays as it is.

The Clusters area added, additively, what `mock/research/acm.md`'s richer `ManagedCluster`
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
the `Models` service wraps one Placement and one MWRS per model (`mock/research/acm.md`,
"Proposal"). `AiGrid` gained `GetHubCapabilities` (`manifest_work_replica_set_enabled`,
`observability_installed`, `acm_version`).

The Tenants area first removed two drafted fields: `Tenant.version` (field 8) and
`UpdateTenantRequest.lock` (field 3) are `reserved`, because Keycloak Organizations have no
server-side version, etag or `Last-Modified` (`mock/research/keycloak.md` 8.1). The review of
the fake server PR brought a version back under a new name and number, kept by the backend
itself in an organization attribute (`mock/areas/tenants.md`, "Version"):
`Tenant.resource_version = 10`, checked when `UpdateTenantRequest.object.resource_version` or
the new `DeleteTenantRequest.resource_version = 2` is set (no flag; `lock` stays reserved), and
`Aborted` when stale. `DeleteModelRequest` gained the same precondition (`resource_version =
3`, a Kubernetes delete precondition), and `ListTenantsResponse.total` and
`ListModelsResponse.total` became `optional`, so a backend that ignores paging and filters
(the shipped one) is visible by the missing count. The Tenants area also added `TenantDomain` and
`repeated TenantDomain domain_details = 9` (`name`, `verified`, `identity_provider_alias`,
`auto_redirect`, the fields Keycloak 26.8 keeps per domain), kept `domains` as the list of
names, and narrowed `ListTenantsRequest.filter` to the one CEL form the backend can push down
to Keycloak's `search`, `this.name.contains("<term>") || this.domains.exists(d, d.contains("<term>"))`.

## Working with the backend team

1. **Proto first.** A new RPC starts in the console's draft (`mock/proto/ai_grid/v1`), proposed
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
