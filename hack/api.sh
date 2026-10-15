#!/usr/bin/env bash
# Call the local BFF as the user from `oc login`.
#
#   hack/api.sh /api/v1/clusters
#   hack/api.sh -X PATCH -d '{"aiGridEnabled":true}' /api/v1/clusters/local-cluster
#
# BFF_URL overrides the base URL (default http://127.0.0.1:8080).
set -euo pipefail
BFF_URL="${BFF_URL:-http://127.0.0.1:8080}"
TOKEN="${AUTH_TOKEN:-$(oc whoami -t)}"
args=()
path=""
for a in "$@"; do
  if [[ "$a" == /* ]]; then path="$a"; else args+=("$a"); fi
done
[[ -n "$path" ]] || { echo "usage: hack/api.sh [curl options] /api/v1/<path>" >&2; exit 2; }
curl -sS -H "x-forwarded-access-token: ${TOKEN}" -H 'Content-Type: application/json' "${args[@]}" "${BFF_URL}${path}"
echo
