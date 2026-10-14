package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var hashedAsset = regexp.MustCompile(`[.\-][0-9a-f]{8,}\.`)

// spaHandler serves the built frontend and falls back to index.html for client
// routes so deep links work.
type spaHandler struct {
	dir   string
	files http.Handler
}

func newSPAHandler(dir string) http.Handler {
	return &spaHandler{dir: dir, files: http.FileServer(http.Dir(dir))}
}

func (s *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean("/" + r.URL.Path)
	r.URL.Path = clean // the file server and ServeFile see only the cleaned path
	target := filepath.Join(s.dir, filepath.FromSlash(clean))
	if info, err := os.Stat(target); err == nil && !info.IsDir() {
		if hashedAsset.MatchString(path.Base(clean)) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		s.files.ServeHTTP(w, r)
		return
	}
	if strings.Contains(path.Base(clean), ".") && clean != "/" {
		// A missing file with an extension is a real 404, not a client route.
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(s.dir, "index.html"))
}
