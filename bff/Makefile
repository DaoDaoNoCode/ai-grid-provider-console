# BFF developer targets. Run from this directory.
PORT ?= 8080
BACKEND_ADDRESS ?= 127.0.0.1:9090
# Hub API server for the provider-admin access review; defaults to the oc login server.
HUB_API_URL ?= $(shell oc whoami --show-server 2>/dev/null)
LOG_LEVEL ?= debug
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -X github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/api.Version=$(VERSION)

.PHONY: all fmt vet lint test build run tidy

all: build

fmt: ## gofmt all packages
	gofmt -l -w .

vet:
	go vet ./...

lint: ## golangci-lint (install: brew install golangci-lint)
	golangci-lint run

test:
	go test -race -count=1 ./...

build: ## build ./bin/bff
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/bff ./cmd

run: ## run against a local ai-grid-backend (hack/dev-backend.sh); callers must send the identity headers
	go run -ldflags "$(LDFLAGS)" ./cmd --port=$(PORT) --backend-address=$(BACKEND_ADDRESS) --hub-api-url=$(HUB_API_URL) --log-level=$(LOG_LEVEL)

tidy:
	go mod tidy
