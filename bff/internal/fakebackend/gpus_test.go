package fakebackend

import (
	"context"
	"log/slog"
	"math"
	"testing"

	"google.golang.org/protobuf/proto"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// An L4 node as ACM Search returns it (labels trimmed to GFD's).
const hubL4Labels = "node-role.kubernetes.io/gpu=; node-role.kubernetes.io/worker=; " +
	"nvidia.com/cuda.driver-version.full=580.105.08; nvidia.com/cuda.runtime-version.full=13.0; " +
	"nvidia.com/gpu.compute.major=8; nvidia.com/gpu.compute.minor=9; nvidia.com/gpu.count=1; " +
	"nvidia.com/gpu.family=ada-lovelace; nvidia.com/gpu.machine=g6.xlarge; nvidia.com/gpu.memory=23034; " +
	"nvidia.com/gpu.present=true; nvidia.com/gpu.product=NVIDIA-L4; nvidia.com/gpu.replicas=1; " +
	"nvidia.com/gpu.sharing-strategy=none; nvidia.com/mig.capable=false; nvidia.com/mps.capable=false"

func TestGPUNodeReadsGFDLabels(t *testing.T) {
	got, ok := gpuNode(SearchNode{
		Cluster: "site-a", Name: "node-a", Label: hubL4Labels,
		Condition: "DiskPressure=False; MemoryPressure=False; PIDPressure=False; Ready=True",
	})
	want := &aigridv1.GPUNode{
		Name: "node-a", Vendor: "NVIDIA", Product: "NVIDIA-L4", Count: 1, MemoryMib: 23034,
		Family: "ada-lovelace", ComputeCapability: "8.9", DriverVersion: "580.105.08", CudaRuntimeVersion: "13.0",
		Sharing:      &aigridv1.GPUSharing{Strategy: "none", Replicas: 1},
		InstanceType: "g6.xlarge", Ready: true,
	}
	if !ok || !proto.Equal(got, want) {
		t.Fatalf("gpuNode = %v, %v; want %v", got, ok, want)
	}

	// A node without nvidia.com/gpu.present=true has no NVIDIA GPU.
	if _, ok := gpuNode(SearchNode{Name: "worker", Label: "node-role.kubernetes.io/worker="}); ok {
		t.Error("a node without gpu.present counted as a GPU node")
	}
	// Ready only from Ready=True, not from a condition that merely ends in it.
	if g, _ := gpuNode(SearchNode{Label: hubL4Labels, Condition: "NotReady=True; Ready=False"}); g.GetReady() {
		t.Error("a node with Ready=False read as ready")
	}
}

func TestGPUSharing(t *testing.T) {
	for name, tc := range map[string]struct {
		labels string
		want   *aigridv1.GPUSharing
	}{
		"none": {"nvidia.com/gpu.sharing-strategy=none; nvidia.com/gpu.replicas=1",
			&aigridv1.GPUSharing{Strategy: "none", Replicas: 1}},
		"time-slicing": {"nvidia.com/gpu.sharing-strategy=time-slicing; nvidia.com/gpu.replicas=4",
			&aigridv1.GPUSharing{Strategy: "time-slicing", Replicas: 4}},
		"MIG single": {"nvidia.com/gpu.sharing-strategy=none; nvidia.com/gpu.replicas=1; nvidia.com/mig.capable=true; nvidia.com/mig.strategy=single",
			&aigridv1.GPUSharing{Strategy: "mig", Replicas: 1, MigCapable: true, MigStrategy: "single"}},
		"MIG capable, not used": {"nvidia.com/mig.capable=true; nvidia.com/mig.strategy=none",
			&aigridv1.GPUSharing{Replicas: 1, MigCapable: true}},
		"no labels": {"", &aigridv1.GPUSharing{Replicas: 1}},
	} {
		if got := gpuSharing(searchLabels(tc.labels)); !proto.Equal(got, tc.want) {
			t.Errorf("%s: %v, want %v", name, got, tc.want)
		}
	}
}

func TestClusterGPUsGroupsConfigurations(t *testing.T) {
	l40s := func(name string) *aigridv1.GPUNode {
		return &aigridv1.GPUNode{Name: name, Vendor: "NVIDIA", Product: "NVIDIA-L40S", Count: 2, MemoryMib: 46068,
			Sharing: &aigridv1.GPUSharing{Strategy: "none", Replicas: 1}}
	}
	h100 := &aigridv1.GPUNode{Name: "a-h100", Vendor: "NVIDIA", Product: "NVIDIA-H100-80GB-HBM3", Count: 4, MemoryMib: 81559,
		Sharing: &aigridv1.GPUSharing{Strategy: "none", Replicas: 1}}
	got := clusterGPUs([]*aigridv1.GPUNode{l40s("z-l40s"), h100, l40s("b-l40s")})
	if got.GetTotal() != 8 || got.GetNodeCount() != 3 {
		t.Fatalf("total %d on %d nodes, want 8 on 3", got.GetTotal(), got.GetNodeCount())
	}
	// Most nodes first, then by product; the nodes by name.
	cfg := got.GetConfigurations()
	if len(cfg) != 2 || cfg[0].GetProduct() != "NVIDIA-L40S" || cfg[0].GetNodeCount() != 2 || cfg[0].GetGpusPerNode() != 2 ||
		cfg[1].GetProduct() != "NVIDIA-H100-80GB-HBM3" || cfg[1].GetNodeCount() != 1 {
		t.Fatalf("configurations = %v", cfg)
	}
	if n := got.GetNodes(); n[0].GetName() != "a-h100" || n[1].GetName() != "b-l40s" || n[2].GetName() != "z-l40s" {
		t.Fatalf("nodes not by name: %v", n)
	}
	// The same product with another sharing is another configuration.
	shared := l40s("c")
	shared.Sharing = &aigridv1.GPUSharing{Strategy: "time-slicing", Replicas: 4}
	if c := clusterGPUs([]*aigridv1.GPUNode{l40s("a"), shared}).GetConfigurations(); len(c) != 2 {
		t.Fatalf("time-sliced and plain L40S merged: %v", c)
	}
	if clusterGPUs(nil) != nil {
		t.Error("a cluster without GPU nodes has an inventory")
	}
}

// The fixtures give each GPU cluster an inventory that matches its capacity, and none to the rest.
func TestFixtureClustersCarryGPUs(t *testing.T) {
	fx, err := Load(repoFixtures)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(fx, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]struct {
		total, nodes, configs int32
		first                 string
	}{
		"site-paris-1":     {32, 4, 1, "NVIDIA-H200"},
		"site-madrid-1":    {4, 1, 1, "NVIDIA-A100-SXM4-40GB-MIG-3g.20gb"},
		"site-ashburn-1":   {2, 2, 1, "NVIDIA-L4-SHARED"},
		"site-frankfurt-1": {8, 3, 2, "NVIDIA-L40S"},
		"local-cluster":    {1, 1, 1, "NVIDIA-L4"},
	} {
		resp, err := s.GetManagedCluster(authed(context.Background()), &aigridv1.GetManagedClusterRequest{Name: name})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		g := resp.GetObject().GetStatus().GetGpus()
		if g.GetTotal() != want.total || g.GetNodeCount() != want.nodes || int32(len(g.GetConfigurations())) != want.configs ||
			g.GetConfigurations()[0].GetProduct() != want.first {
			t.Errorf("%s: gpus = %v", name, g)
		}
	}
	for _, name := range []string{"site-lisbon-1", "site-berlin-1", "edge-lyon-2"} {
		resp, err := s.GetManagedCluster(authed(context.Background()), &aigridv1.GetManagedClusterRequest{Name: name})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if g := resp.GetObject().GetStatus().GetGpus(); g != nil {
			t.Errorf("%s: gpus = %v, want none", name, g)
		}
	}
}

// The fake follows the backend's derivation (ai-grid-provider-backend#33,
// internal/servers/cluster_gpus.go); each case is one place the two used to
// differ.
func TestGPUDerivationMatchesTheBackend(t *testing.T) {
	labels := func(extra string) string {
		return "nvidia.com/gpu.present=true; nvidia.com/gpu.product=NVIDIA-L4; nvidia.com/gpu.count=1; " + extra
	}
	node := func(name, extra string) *aigridv1.GPUNode {
		t.Helper()
		g, ok := gpuNode(SearchNode{Name: name, Label: labels(extra), Condition: "Ready=True"})
		if !ok {
			t.Fatalf("gpuNode(%s) not a GPU node", name)
		}
		return g
	}

	// Replicas below 1 read as 1, as without sharing.
	if r := node("n", "nvidia.com/gpu.replicas=0").GetSharing().GetReplicas(); r != 1 {
		t.Errorf("replicas 0 read as %d, want 1", r)
	}
	// Only the MIG strategies single and mixed make the sharing MIG.
	for strategy, want := range map[string]string{"single": "mig", "mixed": "mig", "none": "none", "bogus": "none"} {
		got := node("n", "nvidia.com/gpu.sharing-strategy=none; nvidia.com/mig.strategy="+strategy).GetSharing()
		if got.GetStrategy() != want {
			t.Errorf("mig.strategy=%s: strategy %q, want %q", strategy, got.GetStrategy(), want)
		}
	}
	// The driver and CUDA versions fall back to their parts, the instance type
	// to the node's instance-type label, and a negative count reads as 0.
	parts := node("n", "nvidia.com/cuda.driver.major=580; nvidia.com/cuda.driver.minor=105; nvidia.com/cuda.driver.rev=08; "+
		"nvidia.com/cuda.runtime.major=13; nvidia.com/cuda.runtime.minor=0; node.kubernetes.io/instance-type=g6.xlarge; "+
		"nvidia.com/gpu.memory=-1")
	if parts.GetDriverVersion() != "580.105.08" || parts.GetCudaRuntimeVersion() != "13.0" ||
		parts.GetInstanceType() != "g6.xlarge" || parts.GetMemoryMib() != 0 {
		t.Errorf("fallbacks = driver %q, cuda %q, instance %q, memory %d", parts.GetDriverVersion(),
			parts.GetCudaRuntimeVersion(), parts.GetInstanceType(), parts.GetMemoryMib())
	}

	// MIG capability tells two configurations apart.
	split := clusterGPUs([]*aigridv1.GPUNode{
		node("a", "nvidia.com/mig.capable=true"),
		node("b", "nvidia.com/mig.capable=false"),
	})
	if len(split.GetConfigurations()) != 2 {
		t.Errorf("MIG-capable and not: %d configurations, want 2", len(split.GetConfigurations()))
	}

	// Same node count and product: more GPUs per node first.
	big := func(name string) *aigridv1.GPUNode {
		g := node(name, "")
		g.Count = 8
		return g
	}
	order := clusterGPUs([]*aigridv1.GPUNode{node("a", ""), big("b")})
	if got := order.GetConfigurations()[0].GetGpusPerNode(); got != 8 {
		t.Errorf("first configuration has %d GPUs per node, want 8", got)
	}

	// The total stops at the largest int32 instead of wrapping negative.
	huge := func(name string) *aigridv1.GPUNode {
		g := node(name, "")
		g.Count = math.MaxInt32
		return g
	}
	if total := clusterGPUs([]*aigridv1.GPUNode{huge("a"), huge("b")}).GetTotal(); total != math.MaxInt32 {
		t.Errorf("total = %d, want %d", total, int32(math.MaxInt32))
	}
}
