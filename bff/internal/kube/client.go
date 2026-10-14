package kube

import (
	"context"
	"fmt"
	"log/slog"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Client bundles the typed and dynamic clients for one caller.
type Client struct {
	Kube    kubernetes.Interface
	Dynamic dynamic.Interface
}

// ClientFactory produces a Client for the identity stored on the context.
type ClientFactory interface {
	ClientFor(ctx context.Context) (*Client, error)
}

// TokenClientFactory builds clients from a base rest.Config (server URL, CA) plus
// the caller's bearer token.
type TokenClientFactory struct {
	base   *rest.Config
	logger *slog.Logger
}

// Options tune how the base rest.Config is loaded.
type Options struct {
	// InsecureSkipVerify disables TLS verification. Development only.
	InsecureSkipVerify bool
}

// NewTokenClientFactory loads the API server location from the in-cluster
// environment or, when not running in a pod, from the kubeconfig resolved by the
// default loading rules (KUBECONFIG, then ~/.kube/config). Any credential found
// there is discarded.
func NewTokenClientFactory(logger *slog.Logger, opts Options) (*TokenClientFactory, error) {
	base, err := loadBaseConfig()
	if err != nil {
		return nil, err
	}
	return newTokenClientFactory(logger, base, opts), nil
}

func newTokenClientFactory(logger *slog.Logger, base *rest.Config, opts Options) *TokenClientFactory {
	anon := rest.AnonymousClientConfig(base)
	if opts.InsecureSkipVerify {
		anon.Insecure = true
		anon.CAFile = ""
		anon.CAData = nil
		logger.Warn("TLS verification towards the API server is disabled")
	}
	logger.Info("kubernetes API server configured", "host", anon.Host)
	return &TokenClientFactory{base: anon, logger: logger}
}

func loadBaseConfig() (*rest.Config, error) {
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w (run oc login or set KUBECONFIG)", err)
	}
	return cfg, nil
}

// Host returns the API server URL the factory talks to.
func (f *TokenClientFactory) Host() string { return f.base.Host }

// ClientFor builds a client for the identity on ctx.
func (f *TokenClientFactory) ClientFor(ctx context.Context) (*Client, error) {
	id, ok := IdentityFrom(ctx)
	if !ok {
		return nil, fmt.Errorf("no caller identity on request context")
	}
	cfg := rest.CopyConfig(f.base)
	cfg.BearerToken = id.Token()
	cfg.BearerTokenFile = ""

	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("create kubernetes client: %w", err)
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("create dynamic client: %w", err)
	}
	return &Client{Kube: kube, Dynamic: dyn}, nil
}
