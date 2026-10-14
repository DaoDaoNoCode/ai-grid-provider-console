# ai-grid-provider-console

AI Grid cloud provider admin console: a React and PatternFly frontend with a Go BFF,
running on an ACM hub. Provider admins use it to enrol clusters into the grid, deploy
models across sites, manage subscriptions and tenants, and watch the fleet.

The console acts as the signed-in user on every call. Locally that is your `oc login`;
in a cluster it is the OpenShift OAuth session from the kube-auth-proxy sidecar.

## Layout

| Path | What |
|---|---|
| `bff/` | Go backend-for-frontend: `/api/v1/*` and the built frontend |
| `frontend/` | Vite, React 18, PatternFly 6 |
| `manifests/` | Kustomize deployment with the kube-auth-proxy sidecar |
| `hack/` | `deploy.sh`, `undeploy.sh`, `api.sh` (curl with your token), `smoke.sh` |
| `docs/dev-setup.md` | Running against a real cluster, checks, deploying |
| `docs/plan/bff-api.md` | API decisions and endpoint list per slice |
| `docs/plan/work-breakdown.md` | Remaining work split into parallel packages |

## Quick start

```sh
oc login ...
make install
make dev          # BFF :8080, frontend :9000
```

Then open http://127.0.0.1:9000. See `docs/dev-setup.md` for details.

## Status

Implemented: healthcheck, user, config, clusters (list, get, enrol/withdraw, location),
locations. Next: models fan-out through ACM Placements and ManifestWorkReplicaSets,
subscriptions, catalog, grid routing, fleet, tenants (see the plan documents).
