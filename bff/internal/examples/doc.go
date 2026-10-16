// Package examples produces the golden responses in mock/examples: the BFF's
// JSON for a fixed set of requests against the fake backend loaded from
// mock/fixtures, at scenario time zero. The files are what a UI built against
// the fake can rely on; golden_test.go keeps them current.
//
//	go test ./internal/examples -run Golden -update   # or: make -C bff golden
package examples
