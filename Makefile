# Root developer targets. See docs/dev-setup.md.
IMAGE ?= ghcr.io/ai-grid-cloud/ai-grid-provider-console
BACKEND_IMAGE ?= ghcr.io/ai-grid-cloud/ai-grid-provider-backend:latest
# make image and make push default to :dev; make deploy needs TAG given (see deploy).
TAG ?= dev
# The hub's architecture, not the build machine's: an Apple-silicon Mac builds linux/amd64 too.
PLATFORM ?= linux/amd64
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
CONTAINER_ENGINE ?= $(shell command -v podman 2>/dev/null || command -v docker)

# The backend address the BFF dials, and where make dev-cluster forwards the hub's backend to.
BACKEND_ADDRESS ?= 127.0.0.1:9090
# Where make dev-cluster forwards the hub's Perses to for the Monitoring page.
PERSES_ADDRESS ?= 127.0.0.1:9445
PERSES_NAMESPACE ?= openshift-cluster-observability-operator
PERSES_SERVICE ?= perses

# The ai-grid-provider-backend commit whose API the console is generated from (make generate-api)
# and runs against in make dev-fake-infra: one full commit SHA in .backend-api-version.
BACKEND_API_VERSION := $(strip $(shell cat .backend-api-version))
BACKEND_REPO ?= https://github.com/ai-grid-cloud/ai-grid-provider-backend.git
# A checkout of the backend to run in make dev-fake-infra; empty clones BACKEND_API_VERSION into
# .cache/backend/<sha> (hack/backend-checkout.sh).
BACKEND_DIR ?=
BUF := go run github.com/bufbuild/buf/cmd/buf@v1.57.2
# The backend's real API at the pin, without its draft (ai_grid.draft.v1), and the googleapis
# commit the backend's proto/buf.lock pins, for google.rpc.BadRequest in its errors.
API_INPUT := $(BACKEND_REPO)\#ref=$(BACKEND_API_VERSION),subdir=proto
GOOGLEAPIS := buf.build/googleapis/googleapis:8ac61b9e502343289c8c42b17aa5b245
# Generates the TypeScript into $(1)/src/gen, from frontend/ (buf.gen.yaml runs the protoc-gen-es
# in frontend/node_modules: make install first).
generate-api-into = cd frontend && \
	$(BUF) generate '$(API_INPUT)' --exclude-path ai_grid/draft --template buf.gen.yaml -o "$(1)" && \
	$(BUF) generate '$(GOOGLEAPIS)' --path google/rpc/error_details.proto --template buf.gen.yaml -o "$(1)"

.PHONY: help start dev dev-cluster dev-fake dev-fake-poc dev-forward-backend dev-forward-perses dev-fake-backend dev-bff dev-bff-fake dev-frontend dev-frontend-fake dev-fake-infra dev-fake-infra-backend dev-bff-fake-infra install lint test build e2e image push manifests deploy undeploy chart-check chart-test generate-api check-generated-api

help: ## Show targets
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

##@ Development against the hub from your kubeconfig (run `oc login` first)

start: dev-cluster ## Same as dev-cluster: oc login, then make start

dev-cluster: ## The console as the hub serves it: its deployed backend (port-forwarded to :9090), the hub's Perses (to :9445, with PERSES_PROJECT set and when you may forward it), the BFF on :8080 and the frontend on :9000
	@BACKEND_ADDRESS=$(BACKEND_ADDRESS) hack/forward-backend.sh --check
	@trap 'kill 0' INT TERM; \
	if [ -z "$$PERSES_URL" ] && [ -z "$$PERSES_PROJECT" ]; then \
		echo "==> Monitoring off: set PERSES_PROJECT to the Perses project whose dashboard- objects are the tabs"; \
	elif [ -z "$$PERSES_URL" ] && PERSES_ADDRESS=$(PERSES_ADDRESS) PERSES_NAMESPACE=$(PERSES_NAMESPACE) PERSES_SERVICE=$(PERSES_SERVICE) hack/forward-perses.sh --check && \
		ca=$${PERSES_CA_FILE:-$$(hack/service-ca.sh $(PERSES_NAMESPACE))}; then \
		$(MAKE) -s dev-forward-perses & \
		export PERSES_URL=https://$(PERSES_ADDRESS) PERSES_SERVER_NAME=$(PERSES_SERVICE).$(PERSES_NAMESPACE).svc PERSES_CA_FILE="$$ca"; \
	elif [ -z "$$PERSES_URL" ]; then \
		echo "==> Monitoring off"; \
	fi; \
	$(MAKE) -s dev-forward-backend & \
	$(MAKE) -s dev-bff & \
	$(MAKE) -s dev-frontend & \
	wait

dev: ## The BFF on :8080 and the frontend on :9000, against a backend you run on BACKEND_ADDRESS (from ai-grid-provider-backend)
	@trap 'kill 0' INT TERM; \
	$(MAKE) -s dev-bff & \
	$(MAKE) -s dev-frontend & \
	wait

dev-forward-backend: ## Forward the backend of the console deployed on the hub to BACKEND_ADDRESS (NAMESPACE, DEPLOYMENT)
	BACKEND_ADDRESS=$(BACKEND_ADDRESS) hack/forward-backend.sh

dev-forward-perses: ## Forward the hub's Perses to PERSES_ADDRESS for the Monitoring page (PERSES_NAMESPACE, PERSES_SERVICE)
	PERSES_ADDRESS=$(PERSES_ADDRESS) PERSES_NAMESPACE=$(PERSES_NAMESPACE) PERSES_SERVICE=$(PERSES_SERVICE) hack/forward-perses.sh

##@ Development without a cluster (fake backend and fake hub from mock/fixtures, see mock/README.md)

dev-fake: ## Run the fake backend on :9090/:9091, the BFF on :8080 and the frontend on :9000; no oc login needed
	@trap 'kill 0' INT TERM; \
	$(MAKE) -s dev-fake-backend & \
	$(MAKE) -s dev-bff-fake & \
	$(MAKE) -s dev-frontend-fake & \
	wait

dev-fake-poc: ## make dev-fake with the PoC's four sites and three models (mock/fixtures-poc), for the visual comparison
	$(MAKE) dev-fake FIXTURES=../mock/fixtures-poc

dev-fake-backend: ## Run the fake ai-grid-backend and fake hub API
	$(MAKE) -C bff fake-backend

dev-bff-fake: ## Run the BFF against the fake backend and fake hub
	$(MAKE) -C bff run-fake

dev-frontend-fake: ## Run the Vite dev server as dev-user with a fixture token (AUTH_TOKEN=viewer-token to see a non-admin)
	cd frontend && AUTH_TOKEN=$${AUTH_TOKEN:-dev-token} AUTH_USER=$${AUTH_USER:-dev-user} pnpm dev

##@ Development on the backend's own fakes (the real backend at .backend-api-version on a fake hub and Keycloak)

dev-fake-infra: ## The backend at .backend-api-version on its fake hub and Keycloak (:9090-:9094), the BFF against it on :8080 (not --fake-backend; it relays /ai_grid.v1.*) and the frontend on :9000; no oc login needed
	@BACKEND_DIR='$(BACKEND_DIR)' BACKEND_REPO='$(BACKEND_REPO)' hack/backend-checkout.sh >/dev/null
	@trap 'kill 0' INT TERM; \
	$(MAKE) -s dev-fake-infra-backend & \
	$(MAKE) -s dev-bff-fake-infra & \
	$(MAKE) -s dev-frontend-fake & \
	wait

dev-fake-infra-backend: ## Run the backend's own `make dev-fake` from a checkout at .backend-api-version (.cache/backend/<sha>, or BACKEND_DIR)
	@dir="$$(BACKEND_DIR='$(BACKEND_DIR)' BACKEND_REPO='$(BACKEND_REPO)' hack/backend-checkout.sh)" && \
	MAKEFLAGS= $(MAKE) -C "$$dir" dev-fake

dev-bff-fake-infra: ## Run the BFF against dev-fake-infra-backend: its backend on BACKEND_ADDRESS, its fake hub on :9091 for the provider-admin check
	$(MAKE) -C bff run BACKEND_ADDRESS=$(BACKEND_ADDRESS) HUB_API_URL=http://127.0.0.1:9091 HUB_CA_FILE=

dev-bff: ## Run the BFF; callers must send the identity headers (see hack/api.sh)
	$(MAKE) -C bff run BACKEND_ADDRESS=$(BACKEND_ADDRESS)

dev-frontend: ## Run the Vite dev server, which injects `oc whoami -t`
	cd frontend && pnpm dev

install: ## Install frontend dependencies
	cd frontend && pnpm install

##@ The backend's API (generated TypeScript in frontend/src/gen)

generate-api: ## Regenerate frontend/src/gen from the backend's proto at .backend-api-version (buf through go run; make install first)
	rm -rf frontend/src/gen
	$(call generate-api-into,.)

check-generated-api: ## Fail when frontend/src/gen differs from what make generate-api writes: stale, hand-edited, missing or left-over files
	tmp="$$(mktemp -d)" && trap 'rm -rf "$$tmp"' EXIT && \
	($(call generate-api-into,$$tmp)) && \
	diff -r "$$tmp/src/gen" frontend/src/gen

##@ Quality

lint: ## Lint the BFF (vet, golangci-lint, buf lint on mock/proto) and the frontend (ESLint, Prettier, tsc, generated API current)
	$(MAKE) -C bff vet lint lint-proto
	cd frontend && pnpm lint && pnpm format:check && pnpm typecheck
	$(MAKE) --no-print-directory check-generated-api

test: ## Run all tests
	$(MAKE) -C bff test
	cd frontend && pnpm test

build: ## Build the BFF binary and the frontend bundle
	$(MAKE) -C bff build
	cd frontend && pnpm build

e2e: ## Browser tests against make dev-fake-poc (Playwright; first run: cd frontend && pnpm exec playwright install chromium)
	cd frontend && pnpm e2e

##@ Packaging and deployment

image: ## Build the container image for PLATFORM (default linux/amd64)
	$(CONTAINER_ENGINE) build --platform $(PLATFORM) --build-arg CONSOLE_VERSION=$(VERSION) -t $(IMAGE):$(TAG) .

push: ## Push the container image
	$(CONTAINER_ENGINE) push $(IMAGE):$(TAG)

manifests: ## Render manifests/base (not an install path: the chart is; kept for undeploy's fallback and the takeover test)
	kustomize build manifests/base

chart-check: ## Lint the Helm chart and check its defaults render manifests/base
	hack/check-chart.sh

chart-test: ## Install the Helm chart into a throwaway kind cluster and check it works (docker, kind)
	hack/test-chart-kind.sh

deploy: ## Deploy IMAGE:TAG to the current cluster with the Helm chart (needs cluster-admin for the OAuthClient)
# TAG must be given: the default :dev is never published, and the Recreate rollout stops the
# running pod before the new one pulls, so a missing tag takes the hub's console down.
ifeq ($(origin TAG),file)
	$(error make deploy needs TAG, a tag the registry has: TAG=sha-<full commit> for CI's, or the one you pushed with make push)
endif
	BACKEND_IMAGE=$(BACKEND_IMAGE) hack/deploy.sh $(IMAGE):$(TAG)

undeploy: ## Remove the release, its secrets and its OAuthClient
	hack/undeploy.sh
