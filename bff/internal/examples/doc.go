// Package examples produces the golden responses in mock/examples: the BFF's
// JSON for a fixed set of requests, answers of its own that reach no backend
// (/api/v1/user, /api/v1/config and its errors). The frontend's tests read
// them as what the BFF sends; golden_test.go keeps them current.
//
//	go test ./internal/examples -run Golden -update   # or: make -C bff golden
package examples
