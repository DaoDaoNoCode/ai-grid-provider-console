# Development setup

The console runs as the user who logged in. Locally that is whoever ran `oc login`; in a
cluster it is whoever signed in through kube-auth-proxy. There is no service-account
credential anywhere in the console.

## Prerequisites

- Go 1.26 or newer, `golangci-lint`
- Node 22 and pnpm 11 (`npm install -g pnpm@11.22.0`)
- `oc`, `kustomize`, `jq`
- `oc login` to an ACM hub. Your account needs to see `ManagedClusters`; to enrol
  clusters it needs `patch` on them.

## Run against a real cluster

```sh
oc login https://api.<hub>:443 --token=...
make install        # once: frontend dependencies
make dev            # BFF on :8080, frontend on :9000
```

Open http://127.0.0.1:9000. The masthead shows the `oc` user; the Clusters page lists the
hub's `ManagedClusters`.

How the token gets there:

1. The Vite dev server proxies `/api` to the BFF and sets `x-forwarded-access-token` from
   `oc whoami -t` (`frontend/vite.config.ts`). After a 401 it re-reads the token, so a new
   `oc login` is picked up without restarting.
2. The BFF takes the API server URL and CA from your kubeconfig and builds a Kubernetes
   client per request with the token from the header (`bff/internal/kube`).

Only the BFF:

```sh
make dev-bff
hack/api.sh /api/v1/user
hack/api.sh -X PATCH -d '{"aiGridEnabled":true,"location":"us-east-1"}' /api/v1/clusters/local-cluster
hack/api.sh -X PATCH -d '{"aiGridEnabled":false,"location":""}' /api/v1/clusters/local-cluster
```

`hack/smoke.sh` builds the BFF, starts it on a spare port and checks the read-only
endpoints against the current cluster.

Environment variables the BFF reads (all optional): `PORT`, `HUB_NAMESPACE`,
`GRID_CONSUMER_URL`, `MAP_TILE_URL`, `BILLING_URL`, `AUTH_TOKEN_HEADER`,
`INSECURE_SKIP_VERIFY`, `LOG_LEVEL`. Run `go run ./cmd --help` in `bff/` for the flags.

## Checks

```sh
make lint    # go vet, golangci-lint, tsc
make test    # go test -race, vitest
make build   # BFF binary and frontend bundle
```

CI runs the same plus `kustomize build` and a container image build.

## Deploy to a cluster

The image bundles the BFF and the built frontend. Login is handled by a kube-auth-proxy
sidecar (`quay.io/opendatahub/odh-kube-auth-proxy`) configured for OpenShift OAuth, the
same proxy RHOAI uses. It sets `X-Forwarded-Access-Token` for the BFF.

```sh
make image IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
make push  IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
make deploy IMAGE=quay.io/<you>/ai-grid-provider-console TAG=dev
```

`hack/deploy.sh` applies `manifests/base` (namespace `ai-grid`, ServiceAccount, a
`system:auth-delegator` binding for token validation, Deployment, Service with an
OpenShift serving certificate, reencrypt Route), waits for the Route host, then creates
the cluster-scoped `OAuthClient` and the secret the proxy reads. Creating the
`OAuthClient` needs cluster-admin. `make undeploy` removes everything but the namespace.

To call the deployed API from a script, send your token as a bearer token; the proxy
validates it with a TokenReview and forwards it:

```sh
curl -H "Authorization: Bearer $(oc whoami -t)" https://<route-host>/api/v1/user
```

The `ai-grid` namespace is also where the console will write its hub resources
(Placements, ManifestWorkReplicaSets). Change it with `kustomize edit set namespace` and
the `HUB_NAMESPACE` env in the Deployment, which defaults to the pod's namespace.
