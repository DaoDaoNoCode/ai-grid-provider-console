# ai-grid-provider-console

AI Grid cloud provider admin console: a React and PatternFly frontend with a thin Go BFF,
running on an ACM hub next to `ai-grid-backend`. Provider admins use it to see and enrol
clusters, deploy models across sites, manage subscriptions and tenants, and watch the fleet.

```
browser --JSON--> kube-auth-proxy + bff --gRPC--> ai-grid-backend --> hub API, Keycloak, metrics
```

The BFF owns login, the browser API and the static frontend. Every call to the cluster
goes through [ai-grid-backend](https://github.com/yuvalturg/ai-grid-backend), which runs in
the same pod. The BFF forwards who is calling, and asks the hub one question itself with
the caller's own token: may this user patch ManagedClusters? That answer is `isProviderAdmin`.

## Layout

| Path | What |
|---|---|
| `bff/` | Go backend-for-frontend: `/api/v1/*` as JSON over the backend's gRPC, plus the built frontend |
| `frontend/` | Vite, React 18, PatternFly 6 |
| `manifests/` | Kustomize deployment: kube-auth-proxy, bff and ai-grid-backend in one pod |
| `hack/` | `dev-backend.sh`, `deploy.sh`, `undeploy.sh`, `api.sh` (curl as you), `smoke.sh` |
| `docs/dev-setup.md` | Running against a real cluster, checks, deploying |
| `docs/plan/bff-api.md` | API decisions, endpoint list, RPCs still needed from the backend |
| `docs/plan/work-breakdown.md` | Work split across backend, BFF and frontend |

## Quick start

```sh
oc login ...
make install
make dev          # backend :9090, BFF :8080, frontend :9000
```

Then open http://127.0.0.1:9000. See `docs/dev-setup.md` for details.

## Status

Implemented: login, user, config, clusters (list, get), tenants (list), readiness tied to
the backend. Next: whatever RPC the backend adds next; see the "Waiting on backend RPCs"
table in `docs/plan/bff-api.md`.
