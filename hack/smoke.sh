#!/usr/bin/env bash
# Smoke test the BFF against a running ai-grid-backend. Starts a BFF on a
# spare port, calls the read-only endpoints and procedures as the user from `oc login`, and
# stops it. Nothing is changed on the cluster.
#
#   BACKEND_ADDRESS  backend gRPC address (default 127.0.0.1:9090: make dev-forward-backend, or one from its repository)
#   HUB_API_URL      hub API server for the provider-admin check (default: oc whoami --show-server)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18080}"
BACKEND_ADDRESS="${BACKEND_ADDRESS:-127.0.0.1:9090}"
HUB_API_URL="${HUB_API_URL:-$(oc whoami --show-server)}"
HUB_CA_FILE="${HUB_CA_FILE:-$("${ROOT}/hack/hub-ca.sh")}"
export BFF_URL="http://127.0.0.1:${PORT}"

(cd "${ROOT}/bff" && go build -o bin/bff ./cmd)
"${ROOT}/bff/bin/bff" --port="${PORT}" --backend-address="${BACKEND_ADDRESS}" --hub-api-url="${HUB_API_URL}" --hub-ca-file="${HUB_CA_FILE}" --log-level=warn &
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

# connect calls a backend procedure through the BFF's Connect relay, as the console does.
connect() {
  local procedure="$1" jqexpr="$2"
  local body
  body="$("${ROOT}/hack/api.sh" -X POST -H 'Connect-Protocol-Version: 1' -d '{}' "/ai_grid.v1.${procedure}")"
  if ! echo "${body}" | jq -e "${jqexpr}" >/dev/null; then
    echo "FAIL ${procedure}: ${body}" >&2
    exit 1
  fi
  echo "ok   ${procedure}"
}

if ! curl -sf "${BFF_URL}/readyz" >/dev/null; then
  echo "FAIL /readyz: no backend at ${BACKEND_ADDRESS} (run make dev-forward-backend, or the backend from its repository)" >&2
  exit 1
fi
echo "ok   /readyz"
check /api/v1/user '.data.username | strings'
check /api/v1/user '.data.isProviderAdmin | type == "boolean"'
check /api/v1/config '.data.version | strings'
# An empty list is {}: Connect's JSON leaves an empty repeated field out.
connect Clusters/List 'has("code") | not'
# Tenants need Keycloak; accept a clean backend error as well as a list.
connect Tenants/List '(has("code") | not) or (.message | type == "string")'
echo "smoke test passed as $(oc whoami) against $(oc whoami --show-server)"
