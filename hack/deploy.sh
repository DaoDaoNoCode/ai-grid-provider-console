#!/usr/bin/env bash
# Deploy the console pod (kube-auth-proxy, BFF, ai-grid-backend) to the
# current cluster and wire OpenShift OAuth login.
#
# Usage: hack/deploy.sh [image[:tag]]
#
# Environment:
#   BACKEND_IMAGE            ai-grid-backend image (default quay.io/ai-grid-cloud/ai-grid-backend:latest)
#   KEYCLOAK_ADMIN_USERNAME  with KEYCLOAK_ADMIN_PASSWORD, creates the secret the
#   KEYCLOAK_ADMIN_PASSWORD  backend uses to list tenants; otherwise tenants fail
#
# Needs cluster-admin: the OAuthClient is cluster scoped. Idempotent.
set -euo pipefail

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

if [[ -n "${KEYCLOAK_ADMIN_PASSWORD:-}" ]]; then
  echo "==> creating secret ai-grid-backend-keycloak"
  oc create secret generic ai-grid-backend-keycloak -n "${NAMESPACE}" \
    --from-literal=username="${KEYCLOAK_ADMIN_USERNAME:-admin}" \
    --from-literal=password="${KEYCLOAK_ADMIN_PASSWORD}" \
    --dry-run=client -o yaml | oc apply -f -
fi

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
