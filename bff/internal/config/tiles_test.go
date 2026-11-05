package config

import (
	"strings"
	"testing"
)

func TestMapTileSource(t *testing.T) {
	t.Parallel()
	for tileURL, want := range map[string]string{
		"": "",
		// A path on the console's own origin: 'self' already covers it.
		"/tiles/{z}/{x}/{y}.png":                            "",
		"https://tile.example.com/{z}/{x}/{y}.png":          "https://tile.example.com",
		"https://{s}.tile.example.com/{z}/{x}/{y}.png":      "https://*.tile.example.com",
		"HTTPS://Tiles.Example.COM:8443/{z}/{x}/{y}{r}.png": "https://tiles.example.com:8443",
		"http://10.0.0.7:8080/{z}/{x}/{y}.png":              "http://10.0.0.7:8080",
		"https://tile.example.com":                          "https://tile.example.com",
	} {
		got, err := MapTileSource(tileURL)
		if err != nil || got != want {
			t.Errorf("MapTileSource(%q) = %q, %v; want %q", tileURL, got, err, want)
		}
	}
}

// A tile URL that names no host a policy source can hold fails the start, rather than a map whose
// tiles the browser refuses.
func TestMapTileSourceRejects(t *testing.T) {
	t.Parallel()
	for _, tileURL := range []string{
		"//tile.example.com/{z}/{x}/{y}.png", // no scheme
		"ftp://tile.example.com/{z}/{x}/{y}.png",
		"tile.example.com/{z}/{x}/{y}.png",
		"https://user@tile.example.com/{z}/{x}/{y}.png",
		"https://[::1]/{z}/{x}/{y}.png",
		"https://tile.{s}.example.com/{z}/{x}/{y}.png", // a placeholder past the first label
		"https://tile.example.com;script-src *;/{z}/{x}/{y}.png",
		"https://tile.example.com'/{z}/{x}/{y}.png",
		"https://tile.example.com /{z}/{x}/{y}.png",
		"https://tile.example.com:port/{z}/{x}/{y}.png",
	} {
		if got, err := MapTileSource(tileURL); err == nil {
			t.Errorf("MapTileSource(%q) = %q, want an error", tileURL, got)
		}
	}
	if _, err := Parse([]string{"--hub-api-url=https://hub.example", "--map-tile-url=//tile.example.com/{z}/{x}/{y}.png"}, lookup(nil)); err == nil || !strings.Contains(err.Error(), "map-tile-url") {
		t.Fatalf("Parse with a tile URL without a scheme: %v, want an error naming map-tile-url", err)
	}
}
