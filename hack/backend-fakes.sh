#!/usr/bin/env bash
# The backend at .backend-api-version on its own fake hub and Keycloak, without make (the Browser
# tests job's image has none): what `make dev-fake-infra-backend` runs through the backend's
# `make dev-fake`, which builds both binaries and calls its hack/dev-fake.sh. The DEV_* variables
# (ports, DEV_FIXTURES, DEV_DRAFT_FIXTURES) go to that script as it reads them. SIGTERM stops both.
set -euo pipefail
dir="$("$(dirname "$0")/backend-checkout.sh")"
cd "${dir}"
mkdir -p bin
go build -buildvcs=false -trimpath -o bin/ai-grid-provider-backend ./cmd/ai-grid-provider-backend
go build -buildvcs=false -trimpath -o bin/ai-grid-fake-infra ./cmd/ai-grid-fake-infra
exec bash hack/dev-fake.sh
