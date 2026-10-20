#!/usr/bin/env bash
# Print the path of a file holding the current kubeconfig context's cluster CA,
# or nothing when the kubeconfig has none (public certificates, system roots).
# Used by `make dev-bff` and hack/smoke.sh to pass --hub-ca-file to the BFF.
#
# A login made with --insecure-skip-tls-verify stores no CA, but the BFF still checks
# the hub's certificate, and uses --hub-ca-file as its only roots. So when the system
# roots don't verify the hub either, the CA comes from the cluster itself: ConfigMap
# kube-root-ca.crt, which every namespace has and which holds the API server's CAs. It is
# used only if it verifies the hub.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/.cache/hub-ca.crt"
cluster() { oc config view --minify --raw -o jsonpath="{.clusters[0].cluster.$1}" 2>/dev/null || true; }
DATA="$(cluster certificate-authority-data)"
if [[ -n "${DATA}" ]]; then
  mkdir -p "${ROOT}/.cache"
  echo "${DATA}" | base64 -d > "${OUT}"
  echo "${OUT}"
  exit 0
fi
CA_FILE="$(cluster certificate-authority)"
if [[ -n "${CA_FILE}" ]]; then
  echo "${CA_FILE}"
  exit 0
fi
SERVER="$(cluster server)"
if [[ "$(cluster insecure-skip-tls-verify)" == "true" && -n "${SERVER}" ]] &&
  ! curl -s -o /dev/null --max-time 10 "${SERVER}/version"; then
  NS="$(oc project -q 2>/dev/null || echo default)"
  mkdir -p "${ROOT}/.cache"
  if oc get configmap kube-root-ca.crt -n "${NS}" -o jsonpath='{.data.ca\.crt}' > "${OUT}" 2>/dev/null && [[ -s "${OUT}" ]] &&
    curl -s -o /dev/null --max-time 10 --cacert "${OUT}" "${SERVER}/version"; then
    echo "${OUT}"
  else
    echo "hub-ca: ${SERVER} isn't trusted by the system roots or the cluster's kube-root-ca.crt; set HUB_CA_FILE" >&2
  fi
fi
