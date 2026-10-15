#!/usr/bin/env bash
# Print the path of a file holding the current kubeconfig context's cluster CA,
# or nothing when the kubeconfig has none (public certificates, system roots).
# Used by `make dev-bff` and hack/smoke.sh to pass --hub-ca-file to the BFF.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$(oc config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' 2>/dev/null || true)"
if [[ -z "${DATA}" ]]; then
  CA_FILE="$(oc config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority}' 2>/dev/null || true)"
  [[ -n "${CA_FILE}" ]] && echo "${CA_FILE}"
  exit 0
fi
mkdir -p "${ROOT}/.cache"
OUT="${ROOT}/.cache/hub-ca.crt"
echo "${DATA}" | base64 -d > "${OUT}"
echo "${OUT}"
