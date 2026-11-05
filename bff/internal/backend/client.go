// Package backend holds the gRPC connection to ai-grid-backend.
//
// The backend owns every interaction with the hub, Keycloak and metrics. The
// BFF calls it over gRPC for the readiness probe only (the standard gRPC
// health service, grpc.health.v1.Health/Check, whose client ships with
// grpc-go), a call made for no caller; the pages call it over Connect through
// the relay (internal/relay), which sends the caller's identity in the
// headers named here.
package backend

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

// The headers the Connect relay sets on every call it passes to the backend:
// the caller's token and identity, as the BFF read them from the proxy.
const (
	MetaAuthorization = "authorization"
	MetaUser          = "x-forwarded-user"
	MetaEmail         = "x-forwarded-email"
	MetaGroups        = "x-forwarded-groups"
)

// Config describes how to reach the backend.
type Config struct {
	// Address is host:port. In the single-pod deployment it is the loopback
	// address of the backend container.
	Address string
	// CAFile enables TLS with this CA. Empty means plaintext, which Dial only
	// accepts for loopback addresses unless Insecure is set.
	CAFile string
	// Insecure allows plaintext to a non-loopback address (development only).
	Insecure bool
	// ServerName overrides the expected TLS server name.
	ServerName string
	// Timeout bounds every relayed call that reads. Zero means 10 seconds.
	Timeout time.Duration
	// WriteTimeout bounds the relay's write procedures. Zero means 30 seconds.
	WriteTimeout time.Duration
}

// Client is the gRPC connection and the one service the BFF calls on it.
type Client struct {
	conn *grpc.ClientConn
	// Health is the standard gRPC health service, which the backend registers
	// for every service it serves (grpchealth in its cmd/ai-grid-provider-backend).
	Health healthpb.HealthClient
}

// Dial creates the connection. It does not connect until the first RPC, so a
// backend that starts later than the BFF is fine. Extra options are for tests.
func Dial(cfg Config, extra ...grpc.DialOption) (*Client, error) {
	tlsCfg, err := cfg.TLS()
	if err != nil {
		return nil, err
	}
	creds := insecure.NewCredentials()
	if tlsCfg != nil {
		creds = credentials.NewTLS(tlsCfg)
	}
	opts := append([]grpc.DialOption{grpc.WithTransportCredentials(creds)}, extra...)
	conn, err := grpc.NewClient(cfg.Address, opts...)
	if err != nil {
		return nil, fmt.Errorf("connect to backend %s: %w", cfg.Address, err)
	}
	return &Client{
		conn:   conn,
		Health: healthpb.NewHealthClient(conn),
	}, nil
}

// Timeouts are Timeout and WriteTimeout, each with its default when unset,
// for the Connect relay.
func (cfg Config) Timeouts() (read, write time.Duration) {
	read, write = cfg.Timeout, cfg.WriteTimeout
	if read <= 0 {
		read = 10 * time.Second
	}
	if write <= 0 {
		write = 30 * time.Second
	}
	return read, write
}

// TLS says how to reach the backend, for the gRPC client and the Connect relay
// (internal/relay) alike: with TLS verified against CAFile (and ServerName,
// when set) when a CA file is given; in plaintext, a nil config, for a
// loopback address, or any address with Insecure; otherwise not at all, as
// the caller's token would cross the network in the clear.
func (cfg Config) TLS() (*tls.Config, error) {
	if strings.TrimSpace(cfg.Address) == "" {
		return nil, fmt.Errorf("backend address must not be empty")
	}
	if cfg.CAFile == "" {
		if !cfg.Insecure && !IsLoopback(cfg.Address) {
			return nil, fmt.Errorf("backend address %s is not loopback: set a CA file for TLS or allow insecure explicitly", cfg.Address)
		}
		return nil, nil
	}
	pem, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, fmt.Errorf("load backend CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("load backend CA: %s holds no PEM certificate", cfg.CAFile)
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: pool, ServerName: cfg.ServerName}, nil
}

// IsLoopback reports whether a host:port target names the local machine.
func IsLoopback(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// Close releases the connection.
func (c *Client) Close() error { return c.conn.Close() }

// EncodeMetadataValue percent-encodes `%` and every byte outside printable
// ASCII (0x20-0x7E) as `%XX`, upper-case hex, so that any proxy header value
// is a valid gRPC metadata value. An ASCII value without `%` stays the same,
// byte for byte. A receiver decodes with plain percent-decoding (Go's
// url.PathUnescape, which leaves `+` alone) and gets the original bytes back,
// UTF-8 for a name such as `équipe-ops`. The groups are encoded one by one
// and joined with `,`; a group never contains one (package identity splits
// the header on it), so the receiver splits first and then decodes. This is
// a proposal to the backend team, not yet agreed: the backend doesn't decode
// it yet and sees a non-ASCII name still encoded (harmless while these values
// are advisory, docs/bff.md).
func EncodeMetadataValue(v string) string {
	if !strings.ContainsFunc(v, func(r rune) bool { return r == '%' || r < 0x20 || r > 0x7e }) {
		return v
	}
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(v); i++ {
		if c := v[i]; c == '%' || c < 0x20 || c > 0x7e {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0f])
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}
