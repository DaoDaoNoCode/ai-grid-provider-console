package celfilter

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

func TestEmptyFilterMatchesEverything(t *testing.T) {
	for _, src := range []string{"", "  \n"} {
		f, err := Compile(src, &aigridv1.Tenant{})
		if err != nil || f != nil {
			t.Fatalf("%q = %v, %v; want no filter", src, f, err)
		}
		if ok, err := f.Match(&aigridv1.Tenant{}, "x", time.Now()); !ok || err != nil {
			t.Errorf("nil filter = %v, %v", ok, err)
		}
	}
}

func TestNowIsTheCallersTime(t *testing.T) {
	f, err := Compile(`now == timestamp("2026-10-15T12:00:00Z")`, &aigridv1.Model{})
	if err != nil {
		t.Fatal(err)
	}
	for at, want := range map[time.Time]bool{time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC): true, time.Date(2026, 10, 15, 12, 0, 1, 0, time.UTC): false} {
		if ok, err := f.Match(&aigridv1.Model{}, "ns/m", at); ok != want || err != nil {
			t.Errorf("at %v = %v, %v", at, ok, err)
		}
	}
}

// A dyn result the checker cannot type is checked at run time.
func TestDynResultMustBeABool(t *testing.T) {
	f, err := Compile(`dyn(this.name)`, &aigridv1.Tenant{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Match(&aigridv1.Tenant{Name: "a"}, "t-1", time.Now())
	if status.Code(err) != codes.InvalidArgument || status.Convert(err).Message() != "filter dyn(this.name) must evaluate to a bool, not string" {
		t.Errorf("dyn string = %v", err)
	}
}

func TestCostLimitStopsARunawayFilter(t *testing.T) {
	tn := &aigridv1.Tenant{}
	for i := range 200 {
		tn.Domains = append(tn.Domains, fmt.Sprintf("d%d.example.com", i))
	}
	src := `this.domains.all(a, this.domains.all(b, this.domains.all(c, a != "")))`
	f, err := Compile(src, &aigridv1.Tenant{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Match(tn, "t-1", time.Now())
	if status.Code(err) != codes.InvalidArgument || !strings.Contains(status.Convert(err).Message(), "cost limit exceeded") {
		t.Errorf("runaway = %v", err)
	}
}
