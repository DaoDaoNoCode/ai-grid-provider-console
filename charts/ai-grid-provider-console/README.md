# ai-grid-provider-console chart

The AI Grid provider console for one ACM hub: one pod with kube-auth-proxy, the console (BFF and
frontend) and `ai-grid-provider-backend`. `hack/deploy.sh` (`make deploy`) installs it with the
OAuthClient and Secrets it expects; `docs/dev-setup.md`, "Deploy to a cluster", has the details.
`values.yaml` documents every value and `values.schema.json` refuses any it doesn't list.

## Images

Each image is `repository:tag`, `repository@digest`, or `repository:tag@digest` when both are set.

- **Backend** (`images.backend`): the build of the backend commit in `.backend-api-version`,
  `ghcr.io/ai-grid-cloud/ai-grid-provider-backend:sha-<commit>` with its digest. That is the commit
  the console's API is generated from, and a console ships with the backend it was built against:
  a newer backend can refuse what an older console sends. `make backend-pin SHA=<commit>` sets it,
  with `manifests/base` and `hack/test-chart-kind.sh`, and `make check-generated-api` fails CI when
  one of them names another build. Override it only to run a backend you built yourself.
- **Console** (`images.console`): `latest` by default. A chart in this repository can't name the
  build of its own commit, which is published only after the commit merges. Set `images.console.tag`
  to `sha-<commit>` (or a digest) when you install; `make deploy` requires `TAG`. Once the chart is
  published, the plan is to stamp the console's tag and digest at release time, as OSAC's
  `osac-installer` does in `.github/workflows/publish-charts.yaml` ("Update image tags in
  values.yaml", before `helm package`).
- **Proxy** (`images.authProxy`): `quay.io/opendatahub/odh-kube-auth-proxy:latest`; the kind test
  pins a digest.
