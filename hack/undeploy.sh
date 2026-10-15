#!/usr/bin/env bash
# Remove the console deployment, its secret and OAuthClient. Keeps the namespace.
set -euo pipefail
NAMESPACE="${NAMESPACE:-ai-grid}"
NAME=ai-grid-provider-console
MANIFESTS="$(cd "$(dirname "$0")/.." && pwd)/manifests/base"
kustomize build "${MANIFESTS}" | grep -v '^kind: Namespace' | oc delete --ignore-not-found -f - || true
oc delete secret "${NAME}-oauth" ai-grid-backend-keycloak -n "${NAMESPACE}" --ignore-not-found
oc delete oauthclient "${NAME}" --ignore-not-found
