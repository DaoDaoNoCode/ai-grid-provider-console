#!/usr/bin/env bash
# Checks the Helm chart (charts/ai-grid-provider-console):
#   - helm lint --strict, with the default values and with every option turned on;
#   - values.schema.json refuses a misspelled value instead of letting Helm drop it;
#   - the Deployment's strategy is Recreate (one backend at a time);
#   - with its default values, it renders the same objects as manifests/base, apart from the
#     Namespace (Helm installs into one: --create-namespace) and Helm's own labels. ai-grid-env-setup
#     still deploys manifests/base, so the two must not drift until it moves to the chart.
# Needs helm, kubectl (kustomize) and yq (mikefarah).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHART="${ROOT}/charts/ai-grid-provider-console"
ALL=(--set backend.clusterWrites=true --set route.host=console.apps.example.com --set tls.serviceCA=false
  --set images.console.digest=sha256:0000000000000000000000000000000000000000000000000000000000000000
  --set 'imagePullSecrets[0].name=pull' --set imagePullPolicy=Always)

helm lint --strict "${CHART}" >/dev/null
helm lint --strict "${CHART}" "${ALL[@]}" >/dev/null
helm template console "${CHART}" -n ai-grid "${ALL[@]}" >/dev/null
if helm template console "${CHART}" -n ai-grid --set backend.clusterwrites=true >/dev/null 2>&1; then
  echo "check-chart: a misspelled value (backend.clusterwrites) renders; values.schema.json must refuse it" >&2
  exit 1
fi
# The BFF reads the log level case-insensitively (slog.Level), so the schema takes both spellings.
helm template console "${CHART}" -n ai-grid --set console.logLevel=INFO >/dev/null
if helm template console "${CHART}" -n ai-grid --set console.logLevel=verbose >/dev/null 2>&1; then
  echo "check-chart: console.logLevel=verbose renders; values.schema.json must refuse it" >&2
  exit 1
fi

# One line per object, keys sorted, Helm's labels dropped, in a stable order.
canonical() {
  yq -o=json -I=0 'select(. != null and .kind != "Namespace")
    | del(.metadata.labels."app.kubernetes.io/instance", .metadata.labels."app.kubernetes.io/managed-by",
          .metadata.labels."app.kubernetes.io/version", .metadata.labels."helm.sh/chart")
    | sort_keys(..)' | sort
}
# One backend at a time: its per-organization write locks live in its process (Recreate, not RollingUpdate).
strategy="$(helm template console "${CHART}" -n ai-grid | yq 'select(.kind == "Deployment") | .spec.strategy.type')"
[[ "${strategy}" == Recreate ]] || { echo "check-chart: the Deployment's strategy is '${strategy}', not Recreate" >&2; exit 1; }
chart="$(helm template console "${CHART}" -n ai-grid | canonical)"
base="$(kubectl kustomize "${ROOT}/manifests/base" | canonical)"
if [[ "${chart}" != "${base}" ]]; then
  echo "check-chart: the chart's defaults and manifests/base differ (< chart, > base):" >&2
  diff <(yq -p=json -P '.' <<<"${chart}") <(yq -p=json -P '.' <<<"${base}") >&2 || true
  exit 1
fi
echo "check-chart: lint passes; the chart's defaults render manifests/base"
