#!/usr/bin/env bash
# Smoke test the BFF against the cluster from `oc login`. Starts a BFF on a
# spare port, calls the read-only endpoints, and stops it. Nothing is changed
# on the cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18080}"
export BFF_URL="http://127.0.0.1:${PORT}"

(cd "${ROOT}/bff" && go build -o bin/bff ./cmd)
"${ROOT}/bff/bin/bff" --port="${PORT}" --log-level=warn &
BFF_PID=$!
trap 'kill ${BFF_PID} 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  curl -sf "${BFF_URL}/healthcheck" >/dev/null 2>&1 && break
  sleep 0.25
done

check() {
  local path="$1" jqexpr="$2"
  local body
  body="$("${ROOT}/hack/api.sh" "${path}")"
  if ! echo "${body}" | jq -e "${jqexpr}" >/dev/null; then
    echo "FAIL ${path}: ${body}" >&2
    exit 1
  fi
  echo "ok   ${path}"
}

check /api/v1/user '.data.username | strings'
check /api/v1/config '.data.hubNamespace | strings'
check /api/v1/clusters '.data | arrays'
check /api/v1/locations '.data | arrays'
echo "smoke test passed as $(oc whoami) against $(oc whoami --show-server)"
