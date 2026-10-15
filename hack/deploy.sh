#!/usr/bin/env bash
# Deploy the console pod (kube-auth-proxy, BFF, ai-grid-backend) to the
# current cluster and wire OpenShift OAuth login.
#
# Usage: hack/deploy.sh [image[:tag]]
#
# Environment:
#   BACKEND_IMAGE            ai-grid-backend image (default quay.io/ai-grid-cloud/ai-grid-backend:latest)
#   KEYCLOAK_URL             required: Keycloak base URL the backend lists tenants from,
#                            https:// where the cluster offers it (the admin password
#                            travels with every call), e.g. the Keycloak Route
#   KEYCLOAK_ADMIN_USERNAME  required: Keycloak admin credentials
#   KEYCLOAK_ADMIN_PASSWORD
#   KEYCLOAK_REALM           realm holding the tenant Organizations (default ai-grid)
#   KEYCLOAK_ADMIN_REALM     realm the admin logs in to (default master)
#   All five end up in secret ai-grid-backend-keycloak, which the backend requires.
#
# Needs cluster-admin: the OAuthClient is cluster scoped. Idempotent.
set -euo pipefail

if [[ -z "${KEYCLOAK_URL:-}" || -z "${KEYCLOAK_ADMIN_USERNAME:-}" || -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]]; then
  echo "KEYCLOAK_URL, KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD must be set: the backend" >&2
  echo "container requires secret ai-grid-backend-keycloak and will not start without it." >&2
  exit 1
fi
KEYCLOAK_REALM="${KEYCLOAK_REALM:-ai-grid}"
KEYCLOAK_ADMIN_REALM="${KEYCLOAK_ADMIN_REALM:-master}"
if [[ "${KEYCLOAK_URL}" == http://* ]]; then
  echo "warning: KEYCLOAK_URL is plaintext; the admin password will cross the network unencrypted" >&2
fi

IMAGE="${1:-quay.io/cfchase/ai-grid-provider-console:latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-quay.io/ai-grid-cloud/ai-grid-backend:latest}"
NAMESPACE="${NAMESPACE:-ai-grid}"
NAME=ai-grid-provider-console
SECRET="${NAME}-oauth"
MANIFESTS="$(cd "$(dirname "$0")/.." && pwd)/manifests/base"

echo "==> applying manifests to namespace ${NAMESPACE} with images ${IMAGE} and ${BACKEND_IMAGE}"
kustomize build "${MANIFESTS}" \
  | sed -e "s#quay.io/cfchase/ai-grid-provider-console:latest#${IMAGE}#" \
        -e "s#quay.io/ai-grid-cloud/ai-grid-backend:latest#${BACKEND_IMAGE}#" \
  | oc apply -f -

echo "==> creating secret ai-grid-backend-keycloak for ${KEYCLOAK_URL} (realm ${KEYCLOAK_REALM})"
oc create secret generic ai-grid-backend-keycloak -n "${NAMESPACE}" \
  --from-literal=url="${KEYCLOAK_URL}" \
  --from-literal=realm="${KEYCLOAK_REALM}" \
  --from-literal=admin-realm="${KEYCLOAK_ADMIN_REALM}" \
  --from-literal=username="${KEYCLOAK_ADMIN_USERNAME}" \
  --from-literal=password="${KEYCLOAK_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | oc apply -f -

echo "==> waiting for the route host"
for _ in $(seq 1 30); do
  HOST="$(oc get route "${NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.host}' 2>/dev/null || true)"
  [[ -n "${HOST}" ]] && break
  sleep 2
done
[[ -n "${HOST:-}" ]] || { echo "route host not assigned" >&2; exit 1; }
REDIRECT_URL="https://${HOST}/oauth2/callback"

if oc get secret "${SECRET}" -n "${NAMESPACE}" >/dev/null 2>&1; then
  CLIENT_SECRET="$(oc get secret "${SECRET}" -n "${NAMESPACE}" -o jsonpath='{.data.OAUTH2_PROXY_CLIENT_SECRET}' | base64 -d)"
  COOKIE_SECRET="$(oc get secret "${SECRET}" -n "${NAMESPACE}" -o jsonpath='{.data.OAUTH2_PROXY_COOKIE_SECRET}' | base64 -d)"
else
  CLIENT_SECRET="$(openssl rand -hex 32)"
  COOKIE_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
fi

echo "==> creating OAuthClient ${NAME} for ${REDIRECT_URL}"
oc apply -f - <<YAML
apiVersion: oauth.openshift.io/v1
kind: OAuthClient
metadata:
  name: ${NAME}
grantMethod: auto
redirectURIs:
  - ${REDIRECT_URL}
secret: ${CLIENT_SECRET}
YAML

echo "==> creating secret ${SECRET}"
oc create secret generic "${SECRET}" -n "${NAMESPACE}" \
  --from-literal=OAUTH2_PROXY_CLIENT_ID="${NAME}" \
  --from-literal=OAUTH2_PROXY_CLIENT_SECRET="${CLIENT_SECRET}" \
  --from-literal=OAUTH2_PROXY_COOKIE_SECRET="${COOKIE_SECRET}" \
  --from-literal=OAUTH2_PROXY_REDIRECT_URL="${REDIRECT_URL}" \
  --dry-run=client -o yaml | oc apply -f -

echo "==> rolling out"
oc rollout restart deployment/"${NAME}" -n "${NAMESPACE}" >/dev/null 2>&1 || true
oc rollout status deployment/"${NAME}" -n "${NAMESPACE}" --timeout=180s
echo "==> console: https://${HOST}"
