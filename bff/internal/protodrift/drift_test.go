// Package protodrift proves that the RPCs the BFF calls on the backend over gRPC still take
// and return, field for field on the wire, the messages the BFF sends and reads: today
// AiGrid/Ping, which /readyz calls through the draft's client (bff/gen/ai_grid/v1), against the
// backend's real proto (mock/proto/upstream, vendored from ai-grid-cloud/ai-grid-provider-backend).
//
// Protobuf is wire compatible across message names, so a field the backend renumbers, retypes
// or drops would silently send or read the wrong data. hack/sync-upstream-proto.sh refreshes the
// vendored copy (nightly in .github/workflows/drift.yaml) and this test fails on every such
// difference. Fields the backend has and the BFF's message lacks are fine: the BFF doesn't use
// them. The pages call the backend's other RPCs over Connect with clients generated from the
// backend's own proto (frontend/src/gen), through the relay, which reads no body.
//
// When the readiness probe calls the backend with the backend's own generated types, this
// package, mock/proto/upstream and drift.yaml go.
package protodrift

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

const (
	upstreamDir     = "../../../mock/proto/upstream"
	upstreamImage   = "image.binpb"
	upstreamPackage = "ai_grid.v1"
)

// calls are the backend RPCs the BFF invokes over gRPC, with the messages it sends and reads.
// Their names may differ from the backend's (AiGridPingRequest); their fields may not.
var calls = []struct {
	method        string
	input, output protoreflect.FullName
}{
	{"ai_grid.v1.AiGrid.Ping", "ai_grid.v1.PingRequest", "ai_grid.v1.PingResponse"},
}

// TestCallsAreTheBFFs keeps calls in step with the code: the readiness probe's Ping.
func TestCallsAreTheBFFs(t *testing.T) {
	t.Parallel()
	ping := strings.ReplaceAll(strings.TrimPrefix(aigridv1.AiGrid_Ping_FullMethodName, "/"), "/", ".")
	if len(calls) != 1 || calls[0].method != ping {
		t.Fatalf("calls = %v, want %s alone", calls, ping)
	}
}

// readImage loads the vendored image: the backend's files and their imports, compiled by buf.
func readImage(t *testing.T) *descriptorpb.FileDescriptorSet {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(upstreamDir, upstreamImage))
	if err != nil {
		t.Fatal(err)
	}
	set := &descriptorpb.FileDescriptorSet{}
	if err := proto.Unmarshal(raw, set); err != nil {
		t.Fatalf("parse %s: %v", upstreamImage, err)
	}
	return set
}

// upstreamFiles resolves an image into its own registry, apart from the draft's ai_grid.v1
// in protoregistry.GlobalFiles, which declares some of the same names.
func upstreamFiles(t *testing.T, set *descriptorpb.FileDescriptorSet) *protoregistry.Files {
	t.Helper()
	files, err := protodesc.NewFiles(set)
	if err != nil {
		t.Fatalf("resolve %s: %v", upstreamImage, err)
	}
	return files
}

func TestUpstreamCommitIsRecorded(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(filepath.Join(upstreamDir, "COMMIT"))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			got[k] = v
		}
	}
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(got["commit"]) {
		t.Errorf("COMMIT must record the full git sha of the vendored proto, got %q", got["commit"])
	}
	if got["repo"] != "https://github.com/ai-grid-cloud/ai-grid-provider-backend" {
		t.Errorf("COMMIT must record the backend repository, got %q", got["repo"])
	}
	if got["path"] != "proto/ai_grid/v1" {
		t.Errorf("COMMIT must record the proto directory in the backend repository, got %q", got["path"])
	}
}

// TestCallsMatchUpstream is the test that fails the day the backend changes an RPC the BFF
// calls, or a message it sends or reads.
func TestCallsMatchUpstream(t *testing.T) {
	t.Parallel()
	c := &checker{upstream: upstreamFiles(t, readImage(t))}
	c.check()
	for _, diff := range c.diffs {
		t.Error(diff)
	}
	if len(c.diffs) > 0 {
		t.Log("the backend proto in mock/proto/upstream no longer matches what the BFF sends: update the draft message the BFF calls it with")
	}
}

// checker compares the BFF's calls with an upstream registry and collects differences.
type checker struct {
	upstream *protoregistry.Files
	diffs    []string
}

func (c *checker) errorf(format string, args ...any) {
	c.diffs = append(c.diffs, fmt.Sprintf(format, args...))
}

func (c *checker) check() {
	for _, call := range calls {
		c.checkCall(call.method, call.input, call.output)
	}
}

func (c *checker) checkCall(method string, input, output protoreflect.FullName) {
	d, err := c.upstream.FindDescriptorByName(protoreflect.FullName(method))
	m, ok := d.(protoreflect.MethodDescriptor)
	if err != nil || !ok {
		c.errorf("the BFF calls %s, which the backend no longer has", method)
		return
	}
	if m.IsStreamingClient() || m.IsStreamingServer() {
		c.errorf("method %s became streaming; the BFF calls it unary", method)
	}
	for _, side := range []struct {
		what string
		up   protoreflect.MessageDescriptor
		bff  protoreflect.FullName
	}{{"takes", m.Input(), input}, {"returns", m.Output(), output}} {
		d, err := protoregistry.GlobalFiles.FindDescriptorByName(side.bff)
		bff, ok := d.(protoreflect.MessageDescriptor)
		if err != nil || !ok {
			c.errorf("method %s: the BFF's message %s isn't linked into the test", method, side.bff)
			continue
		}
		before := len(c.diffs)
		c.compareFields(side.up, bff)
		if len(c.diffs) > before {
			c.diffs = append(c.diffs[:before], append([]string{fmt.Sprintf("method %s %s %s, which no longer matches the BFF's %s:", method, side.what, side.up.FullName(), side.bff)}, c.diffs[before:]...)...)
		}
	}
}

// compareFields reports every field of the BFF's message that the backend's message no
// longer has with the same number, name, cardinality, presence, oneof and type.
func (c *checker) compareFields(up, bff protoreflect.MessageDescriptor) {
	for i := 0; i < bff.Fields().Len(); i++ {
		bf := bff.Fields().Get(i)
		uf := up.Fields().ByNumber(bf.Number())
		if uf == nil {
			c.errorf("field %s (number %d) is gone from the backend's %s", bf.FullName(), bf.Number(), up.FullName())
			continue
		}
		if uf.Name() != bf.Name() {
			c.errorf("field %d of %s: the backend calls it %q, the BFF %q", bf.Number(), up.FullName(), uf.Name(), bf.Name())
		}
		if uf.Cardinality() != bf.Cardinality() {
			c.errorf("field %s: backend cardinality %v, BFF %v", uf.FullName(), uf.Cardinality(), bf.Cardinality())
		}
		if uf.HasPresence() != bf.HasPresence() {
			c.errorf("field %s: backend presence (optional) %v, BFF %v", uf.FullName(), uf.HasPresence(), bf.HasPresence())
		}
		if uf.IsMap() != bf.IsMap() {
			c.errorf("field %s: backend map %v, BFF map %v", uf.FullName(), uf.IsMap(), bf.IsMap())
			continue
		}
		if uo, bo := oneofName(uf), oneofName(bf); uo != bo {
			c.errorf("field %s: backend oneof %q, BFF oneof %q", uf.FullName(), uo, bo)
		}
		if ut, bt := typeName(uf), typeName(bf); ut != bt {
			c.errorf("field %s: backend type %s, BFF type %s", uf.FullName(), ut, bt)
		}
	}
}

// oneofName is the real oneof a field belongs to, or "" for none. Fields that are merely
// `optional` sit in a synthetic oneof, which HasPresence covers.
func oneofName(f protoreflect.FieldDescriptor) string {
	if o := f.ContainingOneof(); o != nil && !o.IsSynthetic() {
		return string(o.Name())
	}
	return ""
}

// typeName renders a field's type: "string", "message ai_grid.v1.Metadata", "enum ...".
func typeName(f protoreflect.FieldDescriptor) string {
	switch f.Kind() {
	case protoreflect.MessageKind, protoreflect.GroupKind:
		return fmt.Sprintf("message %s", f.Message().FullName())
	case protoreflect.EnumKind:
		return fmt.Sprintf("enum %s", f.Enum().FullName())
	default:
		return f.Kind().String()
	}
}

// TestDriftIsDetected guards the guard: each kind of change the backend could make is
// applied to a copy of the vendored image, and the comparison must report it.
func TestDriftIsDetected(t *testing.T) {
	t.Parallel()
	const (
		takes   = "method ai_grid.v1.AiGrid.Ping takes ai_grid.v1.AiGridPingRequest, which no longer matches the BFF's ai_grid.v1.PingRequest:"
		returns = "method ai_grid.v1.AiGrid.Ping returns ai_grid.v1.AiGridPingResponse, which no longer matches the BFF's ai_grid.v1.PingResponse:"
	)
	cases := []struct {
		name   string
		mutate func(t *testing.T, set *descriptorpb.FileDescriptorSet)
		want   []string // a substring of each expected difference, in order
	}{
		{
			name: "field type changed",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				field(t, set, "AiGridPingResponse", "message").Type = descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum()
			},
			want: []string{returns, "field ai_grid.v1.AiGridPingResponse.message: backend type int32, BFF type string"},
		},
		{
			name: "field renamed in place",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				field(t, set, "AiGridPingRequest", "name").Name = proto.String("caller")
			},
			want: []string{takes, `field 1 of ai_grid.v1.AiGridPingRequest: the backend calls it "caller", the BFF "name"`},
		},
		{
			name: "field renumbered",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				field(t, set, "AiGridPingRequest", "name").Number = proto.Int32(2)
			},
			want: []string{takes, "field ai_grid.v1.PingRequest.name (number 1) is gone from the backend's ai_grid.v1.AiGridPingRequest"},
		},
		{
			name: "field became repeated",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				field(t, set, "AiGridPingResponse", "message").Label = descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum()
			},
			want: []string{returns, "AiGridPingResponse.message: backend cardinality repeated, BFF optional"},
		},
		{
			name: "field gained presence",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				msg := message(t, set, "AiGridPingRequest")
				msg.OneofDecl = append(msg.OneofDecl, &descriptorpb.OneofDescriptorProto{Name: proto.String("_name")})
				name := field(t, set, "AiGridPingRequest", "name")
				name.Proto3Optional, name.OneofIndex = proto.Bool(true), proto.Int32(int32(len(msg.OneofDecl)-1))
			},
			want: []string{takes, "AiGridPingRequest.name: backend presence (optional) true, BFF false"},
		},
		{
			name: "field moved into a oneof",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				msg := message(t, set, "AiGridPingRequest")
				msg.OneofDecl = append(msg.OneofDecl, &descriptorpb.OneofDescriptorProto{Name: proto.String("ref")})
				field(t, set, "AiGridPingRequest", "name").OneofIndex = proto.Int32(int32(len(msg.OneofDecl) - 1))
			},
			// A oneof member also has presence, so the field is reported twice.
			want: []string{
				takes,
				"field ai_grid.v1.AiGridPingRequest.name: backend presence (optional) true, BFF false",
				`field ai_grid.v1.AiGridPingRequest.name: backend oneof "ref", BFF oneof ""`,
			},
		},
		{
			name: "method output changed to a message with other fields",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				method(t, set, "AiGrid", "Ping").OutputType = proto.String(".ai_grid.v1.AiGridPingRequest")
			},
			want: []string{
				"method ai_grid.v1.AiGrid.Ping returns ai_grid.v1.AiGridPingRequest, which no longer matches the BFF's ai_grid.v1.PingResponse:",
				`field 1 of ai_grid.v1.AiGridPingRequest: the backend calls it "name", the BFF "message"`,
			},
		},
		{
			name: "method renamed",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				method(t, set, "AiGrid", "Ping").Name = proto.String("Hello")
			},
			want: []string{"the BFF calls ai_grid.v1.AiGrid.Ping, which the backend no longer has"},
		},
		{
			name: "method became server streaming",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				method(t, set, "AiGrid", "Ping").ServerStreaming = proto.Bool(true)
			},
			want: []string{"method ai_grid.v1.AiGrid.Ping became streaming"},
		},
		{
			name: "method became client streaming",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				method(t, set, "AiGrid", "Ping").ClientStreaming = proto.Bool(true)
			},
			want: []string{"method ai_grid.v1.AiGrid.Ping became streaming"},
		},
		{
			name: "additions the BFF doesn't use pass",
			mutate: func(t *testing.T, set *descriptorpb.FileDescriptorSet) {
				resp := message(t, set, "AiGridPingResponse")
				resp.Field = append(resp.Field, &descriptorpb.FieldDescriptorProto{
					Name: proto.String("version"), Number: proto.Int32(99), JsonName: proto.String("version"),
					Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
				})
			},
			want: nil,
		},
	}
	base := readImage(t)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			set := proto.Clone(base).(*descriptorpb.FileDescriptorSet)
			tc.mutate(t, set)
			c := &checker{upstream: upstreamFiles(t, set)}
			c.check()
			if len(c.diffs) != len(tc.want) {
				t.Fatalf("want %d difference(s) %q, got %d: %q", len(tc.want), tc.want, len(c.diffs), c.diffs)
			}
			for i, want := range tc.want {
				if !strings.Contains(c.diffs[i], want) {
					t.Errorf("difference %d = %q, want it to mention %q", i, c.diffs[i], want)
				}
			}
		})
	}
}

// message finds a top-level message of the backend's package in an image.
func message(t *testing.T, set *descriptorpb.FileDescriptorSet, name string) *descriptorpb.DescriptorProto {
	t.Helper()
	for _, f := range set.File {
		if f.GetPackage() != upstreamPackage {
			continue
		}
		for _, m := range f.MessageType {
			if m.GetName() == name {
				return m
			}
		}
	}
	t.Fatalf("no message %s in the vendored image; update this case", name)
	return nil
}

func field(t *testing.T, set *descriptorpb.FileDescriptorSet, msg, name string) *descriptorpb.FieldDescriptorProto {
	t.Helper()
	for _, f := range message(t, set, msg).Field {
		if f.GetName() == name {
			return f
		}
	}
	t.Fatalf("no field %s.%s in the vendored image; update this case", msg, name)
	return nil
}

func method(t *testing.T, set *descriptorpb.FileDescriptorSet, service, name string) *descriptorpb.MethodDescriptorProto {
	t.Helper()
	for _, f := range set.File {
		if f.GetPackage() != upstreamPackage {
			continue
		}
		for _, s := range f.Service {
			if s.GetName() != service {
				continue
			}
			for _, m := range s.Method {
				if m.GetName() == name {
					return m
				}
			}
		}
	}
	t.Fatalf("no method %s.%s in the vendored image; update this case", service, name)
	return nil
}
