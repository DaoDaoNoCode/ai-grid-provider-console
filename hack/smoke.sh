#!/usr/bin/env bash
# Smoke test the BFF against a running ai-grid-backend. Starts a BFF on a
# spare port, calls the read-only endpoints as the user from `oc login`, and
# stops it. Nothing is changed on the cluster.
#
#   BACKEND_ADDRESS  backend gRPC address (default 127.0.0.1:9090, see hack/dev-backend.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18080}"
BACKEND_ADDRESS="${BACKEND_ADDRESS:-127.0.0.1:9090}"
export BFF_URL="http://127.0.0.1:${PORT}"

(cd "${ROOT}/bff" && go build -o bin/bff ./cmd)
"${ROOT}/bff/bin/bff" --port="${PORT}" --backend-address="${BACKEND_ADDRESS}" --log-level=warn &
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

if ! curl -sf "${BFF_URL}/readyz" >/dev/null; then
  echo "FAIL /readyz: no backend at ${BACKEND_ADDRESS} (run hack/dev-backend.sh)" >&2
  exit 1
fi
echo "ok   /readyz"
check /api/v1/user '.data.username | strings'
check /api/v1/config '.data.version | strings'
check /api/v1/clusters '.data | arrays'
# Tenants need Keycloak; accept a clean backend error as well as a list.
check /api/v1/tenants '(.data | type == "array") or (.error.message | type == "string")'
echo "smoke test passed as $(oc whoami) against $(oc whoami --show-server)"
