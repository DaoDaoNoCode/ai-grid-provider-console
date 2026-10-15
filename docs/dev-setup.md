# Development setup

Three processes: `ai-grid-backend` (gRPC, talks to the cluster), the BFF (JSON, talks to
the backend) and the Vite dev server (serves the frontend, proxies `/api` to the BFF). The
console runs as the user who ran `oc login`: the dev proxy sends your name and token the
way kube-auth-proxy would, and the BFF forwards them to the backend.

## Prerequisites

- Go 1.26 or newer, `golangci-lint`
- Node 22 and pnpm 11 (`npm install -g pnpm@11.22.0`)
- `oc`, `kustomize`, `jq`
- `oc login` to an ACM hub. The backend lists `ManagedClusters` with your kubeconfig
  locally; in a cluster it uses its ServiceAccount.

## Run against a real cluster

```sh
oc login https://api.<hub>:443 --token=...
make install        # once: frontend dependencies
make dev            # backend on :9090, BFF on :8080, frontend on :9000
```

Open http://127.0.0.1:9000. The masthead shows the `oc` user; Clusters lists the hub's
`ManagedClusters` as the backend reports them. Tenants shows an error until the backend
can reach a Keycloak with an `ai-grid` realm (the dev hub has Keycloak in `grid-sso` but
no realm yet).

How the pieces connect:

1. `hack/dev-backend.sh` clones `ai-grid-backend` into `.cache/` at the commit pinned in
   `bff/go.mod` and runs it with `--kubeconfig` on `127.0.0.1:9090`. Set `BACKEND_DIR` to
   use your own checkout.
2. The BFF dials `BACKEND_ADDRESS` (default `127.0.0.1:9090`, plaintext) and forwards the
   caller's token as `authorization` metadata (`bff/internal/backend`).
3. The Vite dev server proxies `/api` to the BFF and sets `x-forwarded-access-token` and
   `x-forwarded-user` from `oc whoami` (`frontend/vite.config.ts`). After a 401 they are
   re-read, so a new `oc login` is picked up without restarting. `AUTH_GROUPS` adds a
   groups header for testing `PROVIDER_ADMIN_GROUPS`.

Without the frontend:

```sh
make dev-backend
make dev-bff
hack/api.sh /api/v1/user
hack/api.sh /api/v1/clusters
hack/api.sh /api/v1/tenants
curl -s http://127.0.0.1:8080/readyz
```

`hack/smoke.sh` builds the BFF, starts it on a spare port against the backend on :9090 and
checks the read-only endpoints.

Environment variables the BFF reads (all optional): `PORT`, `BACKEND_ADDRESS`,
`BACKEND_CA_FILE`, `BACKEND_SERVER_NAME`, `BACKEND_INSECURE`, `BACKEND_TIMEOUT`, `PROVIDER_ADMIN_GROUPS`,
`AUTH_TOKEN_HEADER`, `AUTH_USER_HEADER`, `AUTH_EMAIL_HEADER`, `AUTH_GROUPS_HEADER`,
`GRID_CONSUMER_URL`, `MAP_TILE_URL`, `BILLING_URL`, `LOG_LEVEL`. Run `go run ./cmd --help`
in `bff/` for the flags.

## Checks

```sh
make lint    # go vet, golangci-lint, tsc
make test    # go test -race (in-memory gRPC backend), vitest
make build   # BFF binary and frontend bundle
```

CI runs the same plus `kustomize build` and a container image build.

## Deploy to a cluster

One pod with three containers: kube-auth-proxy (`quay.io/opendatahub/odh-kube-auth-proxy`,
OpenShift OAuth, the proxy RHOAI uses), the console image (BFF plus frontend) and
`ai-grid-backend`. The backend binds to loopback, so only the BFF can reach it; the BFF's
`/readyz` is the pod's readiness signal for both.

```sh
make image IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
make push  IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
# build the backend image from its repository: podman build -f Containerfile -t quay.io/<you>/ai-grid-backend:dev . && podman push ...
make deploy IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev BACKEND_IMAGE=quay.io/<you>/ai-grid-backend:dev
```

`hack/deploy.sh` applies `manifests/base` (namespace `ai-grid`, ServiceAccount, a
`system:auth-delegator` binding for token validation, the backend's ManagedCluster
ClusterRole, Deployment, Service with an OpenShift serving certificate, reencrypt Route),
waits for the Route host, then creates the cluster-scoped `OAuthClient` and the secret the
proxy reads. Set `KEYCLOAK_ADMIN_USERNAME` and `KEYCLOAK_ADMIN_PASSWORD` to also create the
secret the backend uses for tenants. Creating the `OAuthClient` needs cluster-admin.
`make undeploy` removes everything but the namespace.

To call the deployed API from a script, send your token as a bearer token; the proxy
validates it with a TokenReview and forwards it:

```sh
curl -H "Authorization: Bearer $(oc whoami -t)" https://<route-host>/api/v1/user
```
