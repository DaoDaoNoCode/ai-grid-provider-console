package celfilter

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

func TestEmptyFilterMatchesEverything(t *testing.T) {
	t.Parallel()
	for _, src := range []string{"", "  \n"} {
		f, err := Compile(src, &aigridv1.Tenant{})
		if err != nil || f != nil {
			t.Fatalf("%q = %v, %v; want no filter", src, f, err)
		}
		if ok, err := f.Match(context.Background(), &aigridv1.Tenant{}, "x", time.Now()); !ok || err != nil {
			t.Errorf("nil filter = %v, %v", ok, err)
		}
	}
}

func TestNowIsTheCallersTime(t *testing.T) {
	t.Parallel()
	f, err := Compile(`now == timestamp("2026-10-15T12:00:00Z")`, &aigridv1.Model{})
	if err != nil {
		t.Fatal(err)
	}
	for at, want := range map[time.Time]bool{time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC): true, time.Date(2026, 10, 15, 12, 0, 1, 0, time.UTC): false} {
		if ok, err := f.Match(context.Background(), &aigridv1.Model{}, "ns/m", at); ok != want || err != nil {
			t.Errorf("at %v = %v, %v", at, ok, err)
		}
	}
}

// A dyn result the checker cannot type is checked at run time.
func TestDynResultMustBeABool(t *testing.T) {
	t.Parallel()
	f, err := Compile(`dyn(this.name)`, &aigridv1.Tenant{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Match(context.Background(), &aigridv1.Tenant{Name: "a"}, "t-1", time.Now())
	if status.Code(err) != codes.InvalidArgument || status.Convert(err).Message() != "filter dyn(this.name) must evaluate to a bool, not string" {
		t.Errorf("dyn string = %v", err)
	}
}

// The cost limit stops a filter whose work grows with the object, and only
// then: the same filter passes on a small object. The limit here is 1000, not
// CostLimit, which would take a million interpreted steps (seconds under the
// race detector) to reach.
func TestCostLimitStopsARunawayFilter(t *testing.T) {
	t.Parallel()
	tenant := func(domains int) *aigridv1.Tenant {
		tn := &aigridv1.Tenant{}
		for i := range domains {
			tn.Domains = append(tn.Domains, fmt.Sprintf("d%d.example.com", i))
		}
		return tn
	}
	src := `this.domains.all(a, this.domains.all(b, this.domains.all(c, a != "")))`
	f, err := compile(src, &aigridv1.Tenant{}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := f.Match(t.Context(), tenant(2), "t-1", time.Now()); !ok || err != nil {
		t.Fatalf("2 domains, 8 steps: %v, %v; want a match", ok, err)
	}
	_, err = f.Match(t.Context(), tenant(20), "t-2", time.Now())
	if status.Code(err) != codes.InvalidArgument || !strings.Contains(status.Convert(err).Message(), "cost limit exceeded") {
		t.Errorf("20 domains, 8000 steps: %v; want InvalidArgument with cost limit exceeded", err)
	}
}

// A List whose caller went away stops evaluating with the context's code,
// not InvalidArgument: the filter is not at fault.
func TestMatchStopsWhenTheContextEnds(t *testing.T) {
	t.Parallel()
	f, err := Compile(`this.name.contains("a")`, &aigridv1.Tenant{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = f.Match(ctx, &aigridv1.Tenant{Name: "a"}, "t-1", time.Now())
	if status.Code(err) != codes.Canceled {
		t.Fatalf("Match after cancel = %v, want Canceled", err)
	}
}
