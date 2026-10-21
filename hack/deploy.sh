#!/usr/bin/env bash
# Deploy the console pod (kube-auth-proxy, BFF, ai-grid-backend) to the
# current cluster with the Helm chart, and wire OpenShift OAuth login.
#
# Usage: hack/deploy.sh [image[:tag]]
#
# Environment:
#   BACKEND_IMAGE            ai-grid-backend image (default ghcr.io/ai-grid-cloud/ai-grid-provider-backend:latest)
#   KEYCLOAK_URL             required: Keycloak base URL the backend lists tenants from,
#                            https:// where the cluster offers it (the admin password
#                            travels with every call), e.g. the Keycloak Route
#   KEYCLOAK_ADMIN_USERNAME  required: Keycloak admin credentials
#   KEYCLOAK_ADMIN_PASSWORD
#   KEYCLOAK_REALM           realm holding the tenant Organizations (default ai-grid)
#   KEYCLOAK_ADMIN_REALM     realm the admin logs in to (default master)
#   All five end up in secret ai-grid-backend-keycloak, which the backend requires.
#   HELM_ARGS                more chart values, e.g. "--set backend.clusterWrites=true"; not the
#                            names of the Secrets, the release's objects or the Route
#
# Needs cluster-admin: the OAuthClient is cluster scoped. Idempotent. A console deployed
# before the chart (kustomize, manifests/base) is taken over in place.
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

IMAGE="${1:-ghcr.io/ai-grid-cloud/ai-grid-provider-console:latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/ai-grid-cloud/ai-grid-provider-backend:latest}"
NAMESPACE="${NAMESPACE:-ai-grid}"
NAME=ai-grid-provider-console
RELEASE="${RELEASE:-ai-grid-provider-console}"
SECRET="${NAME}-oauth"
CHART="$(cd "$(dirname "$0")/.." && pwd)/charts/ai-grid-provider-console"

# The chart's image values for one image reference: repository[:tag][@digest].
image_values() {
  local key=$1 ref=$2 digest="" tag=""
  if [[ "${ref}" == *@* ]]; then
    digest="${ref#*@}"
    ref="${ref%@*}"
  fi
  # A colon in the last path segment is the tag; one before it is a registry port.
  if [[ "${ref##*/}" == *:* ]]; then
    tag="${ref##*:}"
    ref="${ref%:*}"
  fi
  [[ -n "${tag}${digest}" ]] || tag=latest
  echo "--set" "images.${key}.repository=${ref}" "--set" "images.${key}.tag=${tag}" "--set" "images.${key}.digest=${digest}"
}
# shellcheck disable=SC2207 # each value is one word
VALUES=($(image_values console "${IMAGE}") $(image_values backend "${BACKEND_IMAGE}"))
# This script creates the Secrets and the OAuthClient and finds the Route by these names.
case " ${HELM_ARGS:-} " in
  *fullnameOverride* | *oauth.secretName* | *keycloakSecretName* | *route.enabled*)
    echo "HELM_ARGS may not change fullnameOverride, oauth.secretName, backend.keycloakSecretName" >&2
    echo "or route.enabled: this script creates those Secrets and finds the Route by their default names." >&2
    exit 1
    ;;
esac
# shellcheck disable=SC2206 # HELM_ARGS is split on purpose
VALUES+=(${HELM_ARGS:-})

oc create namespace "${NAMESPACE}" --dry-run=client -o yaml | oc apply -f - >/dev/null

echo "==> creating secret ai-grid-backend-keycloak for ${KEYCLOAK_URL} (realm ${KEYCLOAK_REALM})"
oc create secret generic ai-grid-backend-keycloak -n "${NAMESPACE}" \
  --from-literal=url="${KEYCLOAK_URL}" \
  --from-literal=realm="${KEYCLOAK_REALM}" \
  --from-literal=admin-realm="${KEYCLOAK_ADMIN_REALM}" \
  --from-literal=username="${KEYCLOAK_ADMIN_USERNAME}" \
  --from-literal=password="${KEYCLOAK_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | oc apply -f -

# A console deployed before the chart, from manifests/base, becomes this release in place.
"$(dirname "$0")/chart-takeover.sh" "${RELEASE}" "${NAMESPACE}" "${VALUES[@]}"

echo "==> installing chart ${CHART##*/} as release ${RELEASE} in ${NAMESPACE} with images ${IMAGE} and ${BACKEND_IMAGE}"
helm upgrade --install "${RELEASE}" "${CHART}" -n "${NAMESPACE}" "${VALUES[@]}"

echo "==> waiting for the route host"
for _ in $(seq 1 30); do
  HOST="$(oc get route "${NAME}" -n "${NAMESPACE}" -o jsonpath='{.spec.host}' 2>/dev/null || true)"
  [[ -n "${HOST}" ]] && break
  sleep 2
done
[[ -n "${HOST:-}" ]] || { echo "route host not assigned" >&2; exit 1; }
REDIRECT_URL="https://${HOST}/oauth2/callback"

CLIENT_SECRET="$(oc get secret "${SECRET}" -n "${NAMESPACE}" -o jsonpath='{.data.OAUTH2_PROXY_CLIENT_SECRET}' 2>/dev/null | base64 -d || true)"
COOKIE_SECRET="$(oc get secret "${SECRET}" -n "${NAMESPACE}" -o jsonpath='{.data.OAUTH2_PROXY_COOKIE_SECRET}' 2>/dev/null | base64 -d || true)"
CLIENT_SECRET="${CLIENT_SECRET:-$(openssl rand -hex 32)}"
# kube-auth-proxy takes the cookie secret as raw bytes, 16, 24 or 32 of them; 32 hex characters
# are 32 bytes. Replace one of another length (earlier versions of this script made 44).
[[ "${#COOKIE_SECRET}" == 32 ]] || COOKIE_SECRET="$(openssl rand -hex 16)"

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
