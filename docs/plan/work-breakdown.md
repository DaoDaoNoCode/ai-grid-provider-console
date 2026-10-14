# Work breakdown

The foundation branch delivers the repository layout, the BFF with its first endpoints, a
frontend dev shell, deployment manifests and CI. The remaining work is grouped into three
packages that can proceed in parallel. Each package owns distinct directories so that pull
requests do not conflict.

Read `docs/plan/bff-api.md` first. Every endpoint's request and response shape is fixed
there; change that document in the same pull request if a shape has to change.

## Package A: models fan-out (BFF)

Owns `bff/internal/models`, `bff/internal/catalog`, their handlers in `bff/internal/api`.

1. `GET /api/v1/models`: list Placements and ManifestWorkReplicaSets in the hub namespace
   labelled `ai-grid.opendatahub.io/model=<name>`, project `ManagedModel`.
2. `POST /api/v1/models`: validate (`createModelSchema` fields from the POC), write the
   `LLMInferenceService` template, `MaaSModelRef`, Placement and ManifestWorkReplicaSet.
   Follow feature plan 3a exactly: `Namespace` manifest first, `feedbackRules` on the
   `LLMInferenceService` `Ready` condition, `deleteOption.propagationPolicy: SelectivelyOrphan`
   for the namespace, model names capped at 58 characters.
3. Status reader: `status.summary` and conditions of the ReplicaSet, PlacementDecisions,
   per-cluster ManifestWorks selected by label, `statusFeedback` values. Phase derivation from
   feature plan 3c.
4. `PATCH` locations, `PUT` settings, `DELETE` with subscription reference check.
5. Catalog CRUD on ConfigMaps.
6. Tests with fake dynamic clients built from fixtures of real objects (`oc get -o json`).
7. Verify on the hub: enable the `ManifestWorkReplicaSet` feature gate and create a
   `ManagedClusterSetBinding` in the hub namespace first, then deploy the existing
   `facebook-opt-125m` model to `local-cluster`.

## Package B: frontend

Owns `frontend/`.

1. Port the POC pages (Clusters, Models, Deploy wizard, Subscriptions, Tenants) onto the new
   BFF. Keep the POC's service interface pattern: one `ConsoleService` interface, an HTTP
   implementation and a mock implementation; pages never call `fetch`.
2. Masthead shows the user from `/api/v1/user`; actions that need provider-admin rights are
   disabled when `isProviderAdmin` is false.
3. Add the Models detail page and per-site status table (feature plan 3d) against Package A's
   endpoints; use the mock service until they land.
4. Tests with Vitest and Testing Library; component tests use the mock service.
5. Check pages in a browser with `playwright-cli` against the dev proxy.

## Package C: deployment and integrations

Owns `manifests/`, `hack/`, `.github/`, `bff/internal/grid`, `bff/internal/fleet`,
`bff/internal/tenants`.

1. Deploy the image to the hub with `manifests/` and the kube-auth-proxy sidecar; log in
   through the Route; fix anything the first real deployment surfaces (OAuthClient redirect,
   TLS, cookie flags). Add a `make deploy` target.
2. `GET /api/v1/config` reports hub prerequisites: feature gate, `ManagedClusterSetBinding`,
   presence of the `grid.praxis.fast` CRDs, OSAC URL configured.
3. Read-only `GET /api/v1/grid` from the AGN CRDs (feature plan Step 10a).
4. Fleet proxy (Step 5a) once a fleet dashboard URL exists.
5. Tenants against OSAC (Step 6) once OSAC is reachable.

## Shared rules

- Run `make lint test` at the root before opening a pull request; CI runs the same.
- Commits are small and describe the change; no AI attribution trailers.
- New hub resources carry the label `app.kubernetes.io/managed-by: ai-grid-provider-console`
  and `ai-grid.opendatahub.io/<kind>: <name>` so that they can be listed and cleaned up.
