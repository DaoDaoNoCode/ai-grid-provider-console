# Developing without a cluster

`make dev-fake` runs the whole console on a laptop: a fake `ai-grid-backend`, a fake hub API,
the BFF, and the frontend. No `oc login` is needed.

```
browser → Vite :9000 → BFF :8080 → fake ai-grid-backend :9090 (gRPC)
                          └──────→ fake hub API :9091 (SelfSubjectAccessReview)
```

The fake lives in `bff/internal/fakebackend` and runs as `bff/cmd/fake-backend`.

## What the fake is for

The console has to work against the real `ai-grid-backend` with as little change as possible.
So the fake mirrors the real service's shapes and behavior, not a convenient version of them:

- It serves the same `ai_grid.v1` gRPC services, health service, and reflection as the backend.
- Its fixtures use the backend's message types in protojson, with the labels ACM really sets on
  an imported cluster.
- Lists come back sorted by name, as a hub list or Keycloak does, and every response is a copy.
- Every RPC waits for the configured latency and honors cancellation.
- The fake implements every RPC in the proto it's built from, so `make dev-fake` never shows the
  "not available on this backend yet" state. That state comes from a real backend that lacks an
  RPC (the BFF maps `Unimplemented` to `501`); the frontend tests cover it.

When the backend adds an RPC, the fake adds the same RPC with the same behavior.
`TestFakeImplementsEveryProtoMethod` fails until it does: it calls every method in the pinned
proto and fails on any that still answers `Unimplemented`.

## Run it

```sh
make install     # once: frontend dependencies
make dev-fake    # fake backend :9090 and hub :9091, BFF :8080, frontend :9000
```

Open http://127.0.0.1:9000. You're signed in as `dev-user`, a provider admin.

To see the console as another kind of user, set `AUTH_TOKEN` to a token from `access.json`. The
fake hub decides by token alone; `AUTH_USER` only changes the name in the masthead:

| Command | You get |
|---|---|
| `make dev-fake` | A provider admin |
| `AUTH_TOKEN=viewer-token AUTH_USER=viewer make dev-fake` | A signed-in user who isn't a provider admin |
| `AUTH_TOKEN=expired-token AUTH_USER=expired make dev-fake` | A rejected token: `/api/v1/user` returns `401` |

To run the pieces separately, use `make dev-fake-backend`, `make dev-bff-fake`, and
`make dev-frontend-fake`. The fake's flags are `--fixtures`, `--listen-address`,
`--hub-address`, and `--log-level`. Run `go run ./cmd/fake-backend --help` in `bff/` for the
full list.

## Fixtures

`mock/fixtures/` holds the data. Every value is fictional. A missing file leaves its part
empty, except `access.json`: without it every token is a provider admin. The directory itself
must exist. A fixture that fails to load stops the fake with an
error, so a typo doesn't serve nonsense.

| File | Content |
|---|---|
| `managedclusters.json` | `{"clusters": [...]}`: `ai_grid.v1.ManagedCluster` messages in protojson |
| `tenants.json` | `{"tenants": [...]}`: `ai_grid.v1.Tenant` messages, as the backend maps Keycloak Organizations. Replace it with `{"unavailable": "<error text>"}` to simulate a backend that can't reach Keycloak; tenant calls then fail as they do on the dev hub today. |
| `access.json` | The fake hub's answers to the BFF's access review: `defaultAllowed` for any token not listed, `deniedTokens` (signed in, not a provider admin), and `rejectedTokens` (`401`, like an expired token) |
| `settings.json` | `latency`, a Go duration such as `"40ms"`, added to every RPC |

Fixture names, labels, and IDs must never be real: this repository is public.

## Fake hub

The fake hub serves only the part of the Kubernetes API that the BFF uses: `POST`
`/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`. It answers from `access.json` by
bearer token and returns `403` for every other path. It doesn't look at the requested verb or
resource, so every access check gets the same answer for a given token.
