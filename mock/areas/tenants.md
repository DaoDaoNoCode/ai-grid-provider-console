# Tenants (Keycloak Organizations)

What the fake backend and the BFF implement for this area, where they deviate from the
research, which texts are invented, and what remains. The fixture data is described in
`mock/fixtures/README.md`, the HTTP contract in `docs/plan/bff-api.md`, the proto in
`mock/proto/README.md`. The research reports cited here (`mock/research/`) are background
reading.

Implemented. Fake (`bff/internal/fakebackend/{keycloak.go,tenants.go}`): an in-memory
organization store keyed by UUID v4 that answers like the backend's mapping of Keycloak 26.8
(`mock/research/keycloak.md` 3, 5, 8). `CreateTenant` checks in Keycloak's order: an explicit
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
the backend in `mock/research/keycloak.md` 8.2 so they become the contract: the `PermissionDenied`
message ("User ... is not a provider admin: ..."), the `FailedPrecondition` wrapper
(`Keycloak realm "ai-grid": ` before Keycloak's text), the `Unavailable` prefix, the
request-shape messages ("object is required", "id is required", "object.id must be empty"; the
draft rejects a client id that Keycloak would ignore) and "domains and domain_details name
different domains". A client only displays them.
BFF: `GET /api/v1/tenants?offset=&limit=&search=` with a `meta` page, `GET/PATCH/DELETE
/api/v1/tenants/{id}`, `POST /api/v1/tenants` (201 + Location); Keycloak's messages reach the
client as 422 and 409; an absent `enabled` from today's backend (fields 1-3 only) reads as enabled.
UI: main already has a basic, read-only Tenants page (`frontend/src/pages/TenantsPage.tsx`:
name, domains, id), which keeps working because the list's `data` is still an array of
tenants with those fields. Porting the fuller UI for this area (search, paging, create, edit,
enable and delete) is out of scope here; it builds on the HTTP contract in
`docs/plan/bff-api.md`.
Remaining here: members (list, add, remove, invite; the draft has no member RPCs yet, open
question 3 in `mock/research/keycloak.md`), the realm and service-account bootstrap (section 9)
and the `exact` search form.
Backend ask: the `Tenants` CRUD proto as now drafted in `mock/proto/ai_grid/v1/tenant*.proto`
(without `version`/`lock`, with `domain_details` and `optional bool enabled`), keyed by `id`;
the gRPC code table and the proposed message texts in `mock/research/keycloak.md` 8.2 (today every
failure is `Unknown`); reading both Keycloak error body shapes (`errorMessage` and `error`);
a scoped service-account client instead of the master admin.
