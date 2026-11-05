package config

import (
	"fmt"
	"regexp"
	"strings"
)

// tileServer is an absolute tile URL template: http or https, a host name
// whose first label may be a Leaflet placeholder such as {s} (the tile
// server's subdomains), an optional port, then the path. No user info, no IP
// literal in brackets, and nothing in the host a Content-Security-Policy
// source could not hold.
var tileServer = regexp.MustCompile(`^(?i:(https?))://(\{[A-Za-z0-9_-]+\}\.)?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(:[0-9]{1,5})?(?:/|$)`)

// MapTileSource is the source the console's pages may load MapTileURL's tiles
// from, for the img-src of their Content-Security-Policy: the tile server's
// scheme, host and port, with a placeholder first label (Leaflet's {s}) as a
// wildcard, such as https://*.tile.example.com. It is empty when tileURL is
// empty or a path on the console's own origin, which 'self' covers.
func MapTileSource(tileURL string) (string, error) {
	if tileURL == "" || (strings.HasPrefix(tileURL, "/") && !strings.HasPrefix(tileURL, "//")) {
		return "", nil
	}
	m := tileServer.FindStringSubmatch(tileURL)
	if m == nil {
		return "", fmt.Errorf("map-tile-url %q must be a path on the console or an http(s) URL of a host name, whose first label may be a placeholder such as {s}: the console's pages allow images from that host only", tileURL)
	}
	host := strings.ToLower(m[3])
	if m[2] != "" {
		host = "*." + host
	}
	return strings.ToLower(m[1]) + "://" + host + m[4], nil
}
