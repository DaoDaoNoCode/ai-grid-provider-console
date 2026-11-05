# Tenants (Keycloak Organizations)

The Organizations pages, and the Monitoring fallback's usage by organization, call the backend's
own `ai_grid.v1.Tenants` over Connect, through the BFF's relay (`docs/connect.md`, "The
Organizations area"). Neither the console's fake backend nor the BFF has tenants any more: no
`/api/v1/tenants` routes, no draft `Tenants` service, no `tenants.json` fixture, no Keycloak rules
in `bff/internal/fakebackend`. The backend's own fakes do the faking: `make dev-fake-infra` runs
the backend at `.backend-api-version` on its fake hub and fake Keycloak, whose organizations are
its `fixtures/poc/organizations.json` (acme-robotics, globex-research and initech-labs, without
identity providers) under the browser tests, and `fixtures/default` otherwise.

On `make dev-fake` (the console's own fake, gRPC only) the relay has nothing to reach, so the
Organizations list says "Unable to load organizations" with the console's text for an
unreachable backend, and the Monitoring fallback's usage section says it couldn't load them.
Use `make dev-fake-infra` for these pages.

## What the backend does, as the pages rely on it

At the pin (the backend's `internal/servers/tenants_server.go` and `identity_provider.go`):

- **Versions.** `metadata.version` is kept in the organization attribute
  `ai-grid/resource-version`: 1 on create, bumped by every update the backend makes, 1 for an
  organization without it. Update and Delete need it (`InvalidArgument` without one) and answer
  `Aborted` when it is stale; the pages show that as the conflict they always showed.
- **Updates.** The console sends `spec.domains` alone in the mask. The backend accepts `id`,
  `metadata`, `metadata.name`, `metadata.version`, `metadata.creation_timestamp`, `spec`,
  `spec.domains` and `spec.identity_provider`, and refuses any other path.
- **Identity providers.** Set on create only, normalized (an empty title is the name, empty
  scopes are `openid profile email`, `enabled` and `validate_signature` true), and refused on an
  update that adds, changes or removes one. Create reads the client secret from the Secret the
  form names, in `AI_GRID_IDP_SECRET_NAMESPACE`; a missing Secret is `NotFound` (`identity
  provider secret "<name>" not found`), and the organization isn't created. The backend's fake hub
  serves no Secrets, so on its fakes every create with an identity provider is refused that way.
- **Errors.** Plain messages, without `BadRequest` field violations; a taken name or domain is
  `AlreadyExists`, an outage of Keycloak `Internal`, which the pages word as the console's
  generic text.

## What the API doesn't have

The draft's `alias`, `enabled`, `description`, `attributes` and per-domain details (verified,
identity provider link) aren't in the backend's `Tenant`, so the pages show no status, no
description, no attributes and no Verified label. They are backend asks if a page needs them.
`Tenants/ListMembers` stays out of the relay's allowlist: the console never lists an
organization's members (AGENTS.md, decided 2026-10-23).
