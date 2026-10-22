# Development setup

Three processes: the backend ([ai-grid-provider-backend](https://github.com/ai-grid-cloud/ai-grid-provider-backend),
gRPC, talks to the hub and Keycloak), the BFF (JSON, talks to the backend) and the Vite dev
server (serves the frontend, proxies `/api` to the BFF). The BFF and the frontend run from this
repository; the backend never does. It runs where it lives: deployed on the hub, or from its own
repository in a second terminal. The console runs as the user who ran `oc login`: the dev proxy
sends your name and token the way kube-auth-proxy would, and the BFF forwards them to the backend.

## Prerequisites

- Go 1.26 or newer, `golangci-lint`
- Node 22 and pnpm 11 (`npm install -g pnpm@11.22.0`)
- `oc`, `kustomize`, `jq`
- To run against a real hub or deploy (not for `make dev-fake`): `oc login` to an ACM hub. The
  BFF asks that hub whether you may patch `ManagedClusters` (`isProviderAdmin`), using your token.

## Run against a real hub

| You want | Terminal 1 | Terminal 2 (this repository) |
|---|---|---|
| The console as the hub serves it | (none) | `make start` (same as `make dev-cluster`) |
| To change the backend too | the backend repository: run it on `127.0.0.1:9090` against your `oc login` | `make dev` |

```sh
oc login https://api.<hub>:6443 ...
make install     # once: frontend dependencies
make start       # the hub's backend (forwarded to :9090), its Perses (:9445), BFF on :8080, frontend on :9000
```

Open http://127.0.0.1:9000. `make start` needs the console deployed on the hub (`make deploy`, or
[ai-grid-env-setup](https://github.com/ai-grid-cloud/ai-grid-env-setup)): it forwards the backend
container of `ai-grid/ai-grid-provider-console` (`NAMESPACE`, `DEPLOYMENT`) with `oc port-forward`,
so you see what the deployed console shows, from the same backend build, ServiceAccount, RBAC and
Keycloak. Writes are real and go through the deployed backend's ServiceAccount, so they work
exactly where the deployed console's do. On a hub set up by ai-grid-env-setup, which grants that
ServiceAccount `patch` on ManagedClusters, Add to AI Grid and Remove change the hub's clusters. With
`make deploy` alone, `manifests/base/rbac.yaml` grants only `get`, `list` and `watch`, so they are
refused (403). Organization writes answer 501 until the backend serves them. Before it starts
anything, `make start` checks your login, `pods/portforward` in the namespace, an available pod
and a free local port. The forward listens on one loopback address only, reconnects when a rollout
replaces the pod, and creates nothing on the cluster. Pages whose RPCs the backend doesn't serve
yet say "not available on this backend yet".

For the Monitoring page, `make start` also forwards the hub's Perses
(`openshift-cluster-observability-operator/perses`, `PERSES_NAMESPACE`, `PERSES_SERVICE`) to
`127.0.0.1:9445` (`PERSES_ADDRESS`, `hack/forward-perses.sh`) and points the BFF at it, verifying
its certificate with the hub's service CA (`hack/service-ca.sh`). That forward grants nothing:
Perses checks the token the BFF forwards, yours. When the Service is missing, your login may not
port-forward there or the CA can't be read, `make start` says why and runs with Monitoring off
(`PERSES_CA_FILE` you set yourself is used instead of the cluster's). A `PERSES_URL` you set
yourself wins, and no forward starts.

Treat `pods/portforward` in the console's namespace as provider-admin access. Until the backend
authorizes the caller, anyone who can port-forward there reaches the backend directly, here or with
a plain `oc port-forward`, and acts with its ServiceAccount's rights: those of
`manifests/base/rbac.yaml`, or what the deployment adds (ai-grid-env-setup's
`apps/console/manifests` grants `patch` on ManagedClusters). The local BFF's `isProviderAdmin`
check is a convenience, not a boundary: whoever runs the forward can call the backend without it.

To run your own backend instead, start it in a checkout of the backend repository, then run
`make dev` here. It uses your kubeconfig (`KUBECONFIG_PATH`) and needs the Keycloak settings
(`KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`):

```sh
# in ai-grid-provider-backend
KEYCLOAK_ADMIN_USERNAME=... KEYCLOAK_ADMIN_PASSWORD=... \
  make run LISTEN_ADDRESS=127.0.0.1:9090 HTTP_LISTEN_ADDRESS=127.0.0.1:9092 KEYCLOAK_URL=https://<keycloak>
```

Run that way, the backend acts with your `oc login`'s rights, not the deployed ServiceAccount's.
`BACKEND_ADDRESS` moves the address the BFF dials in both targets.

How the pieces connect:

1. The backend, deployed or local, listens on `127.0.0.1:9090` (`BACKEND_ADDRESS`).
2. The BFF listens on `127.0.0.1:8080`, dials `BACKEND_ADDRESS` (plaintext) and forwards the
   caller's token as `authorization` metadata (`bff/internal/backend`). For `/api/v1/user` it posts
   a `SelfSubjectAccessReview` to `HUB_API_URL` with the caller's token (`bff/internal/hub`);
   `make dev-bff` sets it from `oc whoami --show-server`, and `HUB_CA_FILE` from the kubeconfig's
   cluster CA (`hack/hub-ca.sh`). A login made with `--insecure-skip-tls-verify` stores no CA, so
   then the CA comes from the cluster's `kube-root-ca.crt` ConfigMap. Plaintext `http://` is
   accepted for loopback only.
3. The Vite dev server proxies `/api` to the BFF and sets `x-forwarded-access-token` and
   `x-forwarded-user` from `oc whoami` (`frontend/vite.config.ts`). After a 401 they are
   re-read, so a new `oc login` is picked up without restarting. `AUTH_GROUPS` adds a
   groups header, which the BFF only forwards to the backend.

Without the frontend:

```sh
make dev-forward-backend   # or your own backend on :9090
make dev-bff
hack/api.sh /api/v1/user
hack/api.sh /api/v1/clusters
hack/api.sh /api/v1/tenants
hack/api.sh /api/v1/models          # 501 until the backend ships the Models service
curl -s http://127.0.0.1:8080/readyz
```

`hack/smoke.sh` builds the BFF, starts it on a spare port against the backend on :9090 and
checks the read-only endpoints.

## Run without a cluster

```sh
make install     # once: frontend dependencies
make dev-fake    # fake backend :9090 and hub :9091, BFF :8080, frontend :9000
```

No `oc login` is needed. Open http://127.0.0.1:9000. You're signed in as `dev-user`, a provider
admin; set `AUTH_TOKEN=viewer-token AUTH_USER=viewer` to see the console as a user who isn't one.
The fake backend serves the backend's gRPC services from `mock/fixtures/` and answers the BFF's
access review like a hub would. For the endpoints, the tokens, the seeded states, the timed
scenarios and the errors you can provoke, see [mock/AGENTS.md](../mock/AGENTS.md); for every
fixture file and field, [mock/fixtures/README.md](../mock/fixtures/README.md);
[mock/README.md](../mock/README.md) explains why the console runs against a fake. Edit the
fixtures and restart to change the fleet.

## BFF settings

Environment variables the BFF reads: `HUB_API_URL` (required outside a pod; in a pod it
defaults to the in-cluster API server), `HUB_CA_FILE`, `BIND_ADDRESS` (default `127.0.0.1`;
`0.0.0.0` exposes the BFF without a proxy in front), `PORT`, `BACKEND_ADDRESS`,
`BACKEND_CA_FILE`, `BACKEND_SERVER_NAME`, `BACKEND_INSECURE`, `BACKEND_TIMEOUT`,
`PERSES_URL`, `PERSES_CA_FILE`, `PERSES_SERVER_NAME`, `PERSES_INSECURE`, `PERSES_TIMEOUT`,
`PERSES_PROJECT` (the Perses relay, `docs/plan/bff-api.md`),
`AUTH_TOKEN_HEADER`, `AUTH_USER_HEADER`, `AUTH_EMAIL_HEADER`, `AUTH_GROUPS_HEADER`,
`GRID_CONSUMER_URL`, `MAP_TILE_URL`, `BILLING_URL`, `LOG_LEVEL`, `AUTH_TOKEN_PREFIX`,
`CERT_FILE`, `KEY_FILE`, `STATIC_ASSETS_DIR`. Run `go run ./cmd --help`
in `bff/` for the flags.

## Checks

```sh
make lint    # go vet, golangci-lint, buf lint on mock/proto; ESLint, Prettier check, tsc (fix formatting with: cd frontend && pnpm format)
make test    # go test -race (in-memory gRPC backend, proto drift test), vitest
make build   # BFF binary and frontend bundle
```

CI runs the same plus `make -C bff check-generated` (a fresh generation in a temporary
directory must match `bff/gen`, file for file), `kustomize build` and a container image
build. A separate nightly workflow (`.github/workflows/drift.yaml`, also runnable by hand)
refreshes the vendored backend proto from the backend's `main` in the runner's checkout and
runs the drift test, so a backend change to a message or RPC the BFF uses is reported the day
after it merges.

## The proto the BFF compiles against

The BFF imports `bff/gen/ai_grid/v1`, generated from the console's draft proto in
`mock/proto/ai_grid/v1` (the console's proposal, which the fake backend serves; see
`mock/proto/README.md`), and `bff/gen/ai_grid/backend/v1`, generated from its copy of the real
backend's Clusters and Tenants messages in `mock/proto/ai_grid/backend/v1`. After editing a
`.proto` file:

```sh
make -C bff generate      # buf generate; buf and the protoc plugins run through `go run`, nothing to install
make -C bff lint-proto    # buf lint
make -C bff check-generated
```

`generate` and `check-generated` run with `GOTOOLCHAIN` set to the version in `bff/go.mod`,
which is what CI installs, because the generated comments depend on the Go release that builds
`protoc-gen-go`; the first run downloads that toolchain if it is not cached. After a change to
the BFF's JSON or the fixtures, `make -C bff golden` rewrites the golden responses in
`mock/examples/` (see `mock/AGENTS.md`).

`hack/sync-upstream-proto.sh <ref>` refreshes the vendored copy of the backend's real proto,
`proto/ai_grid/v1` of ai-grid-cloud/ai-grid-provider-backend: the files as they are, and an
image `buf build` compiles from them with their imports (it fetches and builds in a temporary
directory and only then replaces `mock/proto/upstream`, so a failed fetch leaves the previous
copy intact). `go test ./internal/protodrift/` then says whether the BFF's copy in
`mock/proto/ai_grid/backend/v1` still matches it, and whether the RPCs the BFF calls still
exist. The vendored commit is the backend's `main` (`mock/proto/upstream/COMMIT`), and the nightly
`.github/workflows/drift.yaml` checks the copy against the newest one.

## Deploy to a cluster

One pod with three containers: kube-auth-proxy (`quay.io/opendatahub/odh-kube-auth-proxy`,
OpenShift OAuth, the proxy RHOAI uses), the console image (BFF plus frontend) and
`ai-grid-backend`. The BFF and the backend both bind to loopback, so nothing on the pod
network can reach either of them without going through the proxy. The kubelet probes the
BFF's `/readyz` through the proxy, which passes that one path without login; it pings the
backend, so it is the readiness signal for all three containers.

CI publishes the console to `ghcr.io/ai-grid-cloud/ai-grid-provider-console`: every merge to
`main` as `sha-<full commit>` and `latest`, each `v*` tag by version, and each open pull request
as `pr-<number>` (deleted when it closes). Deploy a published image with
`IMAGE=ghcr.io/ai-grid-cloud/ai-grid-provider-console TAG=sha-<full commit>`, or build your own.
A new ghcr package starts private: when CI first publishes a new image, an organization owner
sets the package's visibility to Public, or clusters need a pull secret.

```sh
make image IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
make push  IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
# build the backend image from its repository: podman build -f Containerfile -t quay.io/<you>/ai-grid-provider-backend:dev . && podman push ...
KEYCLOAK_URL=https://<keycloak-route-host> KEYCLOAK_ADMIN_USERNAME=... KEYCLOAK_ADMIN_PASSWORD=... \
  make deploy IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev BACKEND_IMAGE=quay.io/<you>/ai-grid-provider-backend:dev
```

`hack/deploy.sh` applies `manifests/base` (namespace `ai-grid`, ServiceAccount, a
`system:auth-delegator` binding for token validation, the backend's ManagedCluster
ClusterRole, Deployment, Service with an OpenShift serving certificate, reencrypt Route),
waits for the Route host, then creates the cluster-scoped `OAuthClient` and the secret the
proxy reads. `KEYCLOAK_URL`, `KEYCLOAK_ADMIN_USERNAME` and `KEYCLOAK_ADMIN_PASSWORD` are
required, with `KEYCLOAK_REALM` (default `ai-grid`) and `KEYCLOAK_ADMIN_REALM` (default
`master`) optional: all five become the secret the backend container mounts, so the
manifests carry no environment's values and the pod does not start without the secret,
which keeps the backend off its built-in default credentials. Use an `https://` URL where
the cluster offers one, since the admin password travels with every call; on the dev hub
that is the Keycloak Route in `grid-sso`, as its Service is plain HTTP. Creating the
`OAuthClient` needs cluster-admin.
`make undeploy` removes everything but the namespace.

To call the deployed API from a script, send your token as a bearer token; the proxy
validates it with a TokenReview and forwards it:

```sh
curl -H "Authorization: Bearer $(oc whoami -t)" https://<route-host>/api/v1/user
```
