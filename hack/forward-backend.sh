#!/usr/bin/env bash
# Forward the backend of the console deployed on the hub from your `oc login` to the address
# the local BFF dials, so `make dev-cluster` shows what the deployed console shows: the same
# backend build, ServiceAccount, RBAC and Keycloak. The backend listens on the pod's loopback
# only; `oc port-forward` reaches it there and creates nothing on the cluster (it needs
# pods/portforward in the namespace). Reconnects when the stream drops or a rollout replaces the pod.
#
#   NAMESPACE        namespace of the deployed console (default ai-grid)
#   DEPLOYMENT       its Deployment (default ai-grid-provider-console)
#   BACKEND_ADDRESS  local address to listen on (default 127.0.0.1:9090; one loopback address)
#
# With --check it only verifies that it can forward (login, permission, a ready pod, a free local
# port), so make dev-cluster stops before starting the BFF and the frontend when it can't.
set -euo pipefail
NAMESPACE="${NAMESPACE:-ai-grid}"
DEPLOYMENT="${DEPLOYMENT:-ai-grid-provider-console}"
BACKEND_ADDRESS="${BACKEND_ADDRESS:-127.0.0.1:9090}"
HOST="${BACKEND_ADDRESS%:*}"
HOST="${HOST#[}"
HOST="${HOST%]}"
PORT="${BACKEND_ADDRESS##*:}"

fail() {
  echo "forward-backend: $*" >&2
  exit 1
}

# The backend authenticates nobody and acts with the deployed ServiceAccount, so it must not be
# reachable from anywhere but this machine. Exactly one loopback address: `oc port-forward
# --address` also takes a comma-separated list, which could add 0.0.0.0.
loopback='^(127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|localhost|::1)$'
[[ "${HOST}" =~ ${loopback} ]] ||
  fail "BACKEND_ADDRESS must be one loopback address and a port, not ${BACKEND_ADDRESS}: the backend has no authentication of its own"
if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || ((PORT < 1 || PORT > 65535)); then
  fail "BACKEND_ADDRESS has no valid port: ${BACKEND_ADDRESS}"
fi

# Something already answers on the address: the BFF would talk to it instead of the hub's backend.
port_taken() {
  (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null
}

oc whoami >/dev/null 2>&1 || fail "run oc login first"
if ! oc get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" >/dev/null 2>&1; then
  echo "forward-backend: no ${NAMESPACE}/${DEPLOYMENT} on $(oc whoami --show-server)." >&2
  echo "  Deploy the console there (make deploy, or ai-grid-cloud/ai-grid-env-setup), or run the" >&2
  echo "  backend from its own repository on ${BACKEND_ADDRESS} and use make dev." >&2
  exit 1
fi
[[ "$(oc auth can-i create pods/portforward -n "${NAMESPACE}" 2>/dev/null)" == yes ]] ||
  fail "your login may not port-forward in ${NAMESPACE} (pods/portforward)"
[[ "$(oc get deployment "${DEPLOYMENT}" -n "${NAMESPACE}" -o jsonpath='{.status.availableReplicas}')" =~ ^[1-9] ]] ||
  fail "${NAMESPACE}/${DEPLOYMENT} has no available pod: oc get pods -n ${NAMESPACE}"
port_taken && fail "${BACKEND_ADDRESS} is already in use; stop what listens there, or set BACKEND_ADDRESS"
if [[ "${1:-}" == "--check" ]]; then
  exit 0
fi

# Stop the forward with this script, also when only this script is signalled.
child=
stop() {
  trap - INT TERM EXIT
  if [[ -n "${child}" ]]; then
    kill "${child}" 2>/dev/null || true
    wait "${child}" 2>/dev/null || true
  fi
  exit "${1:-0}"
}
trap 'stop 130' INT
trap 'stop 143' TERM
trap 'stop $?' EXIT

echo "==> backend of ${NAMESPACE}/${DEPLOYMENT} on $(oc whoami --show-server) at ${BACKEND_ADDRESS}"
while true; do
  # 9090 is the backend's --listen-address in manifests/base/deployment.yaml.
  oc port-forward -n "${NAMESPACE}" "deployment/${DEPLOYMENT}" --address "${HOST}" "${PORT}:9090" &
  child=$!
  wait "${child}" || true
  child=
  # The forward is gone, so anything answering now is someone else's listener.
  port_taken && fail "${BACKEND_ADDRESS} was taken by another process; stopping"
  echo "forward-backend: the port-forward ended (a dropped connection or a rollout); retrying" >&2
  sleep 2
done
