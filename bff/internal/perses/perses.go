// Package perses relays the console's Monitoring page to the hub's Perses server, the way the
// OpenShift AI dashboard relays its Observability page (odh-dashboard packages/observability: the
// browser calls /perses/api only, and the dashboard's backend forwards it with the user's token).
//
// The relay decides nothing about the data: Perses authenticates the caller's token and authorizes
// each project, and its datasource proxy runs the PromQL. What the relay owns is the boundary: only
// the read-only dashboard, datasource and query paths the Perses React components call pass, only
// with GET (and POST for queries, which the Prometheus plugin sends as a form), with the caller's
// own token and nothing else of theirs.
package perses

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	neturl "net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"time"
)

// Prefix is where the relay is mounted; the rest of the path is the Perses API path.
const Prefix = "/perses/api"

// MaxBodyBytes bounds a query form. PromQL in a form is a few kilobytes.
const MaxBodyBytes = 1 << 20

// Config locates the Perses server.
type Config struct {
	// URL is the Perses server, for example
	// https://perses.openshift-cluster-observability-operator.svc:8080.
	URL string
	// CAFile verifies its certificate; empty uses the system roots.
	CAFile string
	// ServerName overrides the name its certificate must carry, for a port-forward to 127.0.0.1.
	ServerName string
	// Insecure allows plaintext to a non-loopback host. The caller's token travels with every
	// request, so this is for development only.
	Insecure bool
	// Timeout bounds the exchange with Perses, from connecting to the last byte of its answer:
	// past it the relay answers 504, or cuts an answer already started. A browser that stops
	// reading is the server's write timeout's to cut. Zero means 30 seconds.
	Timeout time.Duration
}

// Relay is an http.Handler for the paths under Prefix.
type Relay struct {
	target  *neturl.URL
	timeout time.Duration
	proxy   *httputil.ReverseProxy
}

// New builds a relay. It fails when the URL is not usable or the CA file cannot be read.
func New(cfg Config) (*Relay, error) {
	raw := strings.TrimRight(strings.TrimSpace(cfg.URL), "/")
	target, err := neturl.Parse(raw)
	if err != nil || target.Host == "" || (target.Scheme != "https" && target.Scheme != "http") {
		return nil, fmt.Errorf("perses URL %q must be http(s)://host[:port]", cfg.URL)
	}
	if target.Scheme == "http" && !cfg.Insecure && !isLoopbackHost(target.Hostname()) {
		return nil, fmt.Errorf("perses URL %q is plaintext; the caller's token travels with every request, so only https:// is accepted for non-loopback hosts (or allow insecure explicitly)", raw)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: cfg.ServerName}
	if cfg.CAFile != "" {
		pem, err := os.ReadFile(cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("read perses CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("perses CA file %s holds no PEM certificate", cfg.CAFile)
		}
		tlsCfg.RootCAs = pool
	}
	transport.TLSClientConfig = tlsCfg

	r := &Relay{target: target, timeout: timeout}
	r.proxy = &httputil.ReverseProxy{
		Rewrite:        r.rewrite,
		Transport:      transport,
		ModifyResponse: modifyResponse,
		ErrorHandler:   errorHandler,
	}
	return r, nil
}

// URL is the Perses server the relay forwards to, for the startup log.
func (r *Relay) URL() string { return r.target.String() }

type tokenKey struct{}

// WithToken stores the caller's token for the relay to forward.
func WithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, tokenKey{}, token)
}

// ServeHTTP relays an allowed request with the caller's token from the context.
func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	apiPath, ok := strings.CutPrefix(req.URL.Path, Prefix)
	if !ok {
		writeError(w, http.StatusNotFound, "the requested resource could not be found")
		return
	}
	if status, msg := Allowed(req.Method, apiPath, req.URL.RawPath); status != 0 {
		writeError(w, status, msg)
		return
	}
	if req.Method == http.MethodPost {
		if mt := strings.TrimSpace(strings.SplitN(req.Header.Get("Content-Type"), ";", 2)[0]); !strings.EqualFold(mt, "application/x-www-form-urlencoded") {
			writeError(w, http.StatusUnsupportedMediaType, "a Perses query must be sent as application/x-www-form-urlencoded")
			return
		}
		req.Body = http.MaxBytesReader(w, req.Body, MaxBodyBytes)
	}
	token, _ := req.Context().Value(tokenKey{}).(string)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "missing caller token")
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), r.timeout)
	defer cancel()
	r.proxy.ServeHTTP(w, req.WithContext(ctx))
}

// forwardedHeaders are the only request headers that reach Perses besides Authorization. Cookies,
// the proxy's identity headers and any client-sent Authorization stay behind.
var forwardedHeaders = []string{"Accept", "Accept-Language", "Content-Type"}

func (r *Relay) rewrite(pr *httputil.ProxyRequest) {
	apiPath := strings.TrimPrefix(pr.In.URL.Path, Prefix)
	pr.Out.URL.Scheme = r.target.Scheme
	pr.Out.URL.Host = r.target.Host
	pr.Out.URL.Path = r.target.Path + apiPath
	pr.Out.URL.RawPath = ""
	pr.Out.URL.RawQuery = pr.In.URL.RawQuery
	pr.Out.Host = r.target.Host

	h := http.Header{}
	for _, k := range forwardedHeaders {
		if v := pr.In.Header.Values(k); len(v) > 0 {
			h[http.CanonicalHeaderKey(k)] = v
		}
	}
	token, _ := pr.In.Context().Value(tokenKey{}).(string)
	h.Set("Authorization", "Bearer "+token)
	pr.Out.Header = h
}

// modifyResponse keeps Perses from setting cookies on the console's origin.
func modifyResponse(resp *http.Response) error {
	resp.Header.Del("Set-Cookie")
	return nil
}

func errorHandler(w http.ResponseWriter, req *http.Request, err error) {
	var maxBytes *http.MaxBytesError
	var netErr net.Error
	switch {
	case errors.As(err, &maxBytes):
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("a Perses query must be at most %d bytes", MaxBodyBytes))
	case errors.Is(err, context.Canceled):
		// The browser went away; nobody reads the answer.
		w.WriteHeader(499)
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		writeError(w, http.StatusGatewayTimeout, "the hub's Perses did not answer in time")
	default:
		writeError(w, http.StatusBadGateway, "the hub's Perses could not be reached; try again")
	}
}

var (
	name = `[^/]+`
	// readPaths are the Perses API reads the dashboard components make.
	readPaths = regexp.MustCompile(`^/api/v1/(` +
		`dashboards` +
		`|projects/` + name + `/dashboards(/` + name + `)?` +
		`|projects/` + name + `/datasources(/` + name + `)?` +
		`|globaldatasources(/` + name + `)?` +
		`)$`)
	// queryPaths are reads through a datasource's proxy: the Prometheus and Loki query APIs only.
	queryPaths = regexp.MustCompile(`^/proxy/(` +
		`projects/` + name + `/(dashboards/` + name + `/)?datasources/` + name +
		`|globaldatasources/` + name +
		`)/(` +
		`api/v1/(query|query_range|query_exemplars|series|labels|label/` + name + `/values|metadata|parse_query|format_query)` +
		`|loki/api/v1/(query|query_range|labels|label/` + name + `/values|series|index/stats|index/volume|index/volume_range|detected_labels|detected_fields|patterns)` +
		`)$`)
)

// Allowed reports whether a request may be relayed: zero when it may, otherwise the status and
// message to answer with. apiPath is the decoded path after Prefix; rawPath is the request's
// escaped path when it differs from the decoded one.
func Allowed(method, apiPath, rawPath string) (int, string) {
	// An encoded slash, a dot segment or a doubled slash could make Perses see another path than
	// the one checked here.
	if strings.Contains(strings.ToLower(rawPath), "%2f") || apiPath == "" || path.Clean(apiPath) != apiPath {
		return http.StatusNotFound, "the requested resource could not be found"
	}
	isQuery := queryPaths.MatchString(apiPath)
	if !isQuery && !readPaths.MatchString(apiPath) {
		return http.StatusNotFound, "the requested resource could not be found"
	}
	switch {
	case method == http.MethodGet:
		return 0, ""
	case method == http.MethodPost && isQuery:
		return 0, ""
	default:
		return http.StatusMethodNotAllowed, "the console reads Perses only"
	}
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// writeError answers in the console's error envelope.
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	body := map[string]map[string]string{"error": {"code": fmt.Sprint(status), "message": message}}
	_ = json.NewEncoder(w).Encode(body)
}
