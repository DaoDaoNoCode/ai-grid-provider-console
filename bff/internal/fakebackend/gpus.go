package fakebackend

import (
	"cmp"
	"math"
	"slices"
	"strconv"
	"strings"

	"google.golang.org/protobuf/proto"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// SearchNode is one `kind=Node` item as ACM Search (search-v2, the
// search-search-api GraphQL `search` query) returns it: the cluster, the node
// name, every node label as one "key=value; key=value" string, and the
// conditions as "Type=Status; ...". That is where the hub sees a spoke's GPUs:
// ManagedClusterInfo keeps no NVIDIA GPU Feature Discovery labels (checked on
// a dev hub). The real backend reads these items from Search; the fake
// reads them from gpunodes.json and derives the same ClusterGPUs.
type SearchNode struct {
	Cluster   string `json:"cluster"`
	Name      string `json:"name"`
	Label     string `json:"label"`
	Condition string `json:"condition"`
}

// GPU Feature Discovery's labels (NVIDIA k8s-device-plugin, gpu-feature-discovery),
// as seen on the dev hub's spokes.
const (
	gfdPresent         = "nvidia.com/gpu.present"
	gfdProduct         = "nvidia.com/gpu.product"
	gfdCount           = "nvidia.com/gpu.count"
	gfdMemory          = "nvidia.com/gpu.memory"
	gfdFamily          = "nvidia.com/gpu.family"
	gfdComputeMajor    = "nvidia.com/gpu.compute.major"
	gfdComputeMinor    = "nvidia.com/gpu.compute.minor"
	gfdDriverVersion   = "nvidia.com/cuda.driver-version.full"
	gfdDriverMajor     = "nvidia.com/cuda.driver.major"
	gfdDriverMinor     = "nvidia.com/cuda.driver.minor"
	gfdDriverRev       = "nvidia.com/cuda.driver.rev"
	gfdRuntimeVersion  = "nvidia.com/cuda.runtime-version.full"
	gfdRuntimeMajor    = "nvidia.com/cuda.runtime.major"
	gfdRuntimeMinor    = "nvidia.com/cuda.runtime.minor"
	gfdMachine         = "nvidia.com/gpu.machine"
	nodeInstanceType   = "node.kubernetes.io/instance-type"
	gfdReplicas        = "nvidia.com/gpu.replicas"
	gfdSharingStrategy = "nvidia.com/gpu.sharing-strategy"
	gfdMIGCapable      = "nvidia.com/mig.capable"
	gfdMIGStrategy     = "nvidia.com/mig.strategy"
)

// searchLabels splits Search's "key=value; key=value" label string. A label
// with an empty value ("node-role.kubernetes.io/gpu=") keeps it empty.
func searchLabels(s string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(s, "; ") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && k != "" {
			out[k] = v
		}
	}
	return out
}

// The derivation below follows the backend's (ai-grid-provider-backend#33,
// internal/servers/cluster_gpus.go) field for field, so the fake answers what
// the real backend would for the same nodes.

// atoi32 and atoi64 read a count, 0 for one that is missing, malformed or
// negative (cluster_gpus.go atoi32, atoi64).
func atoi32(s string) int32 {
	v, err := strconv.ParseInt(s, 10, 32)
	if err != nil || v < 0 {
		return 0
	}
	return int32(v)
}

func atoi64(s string) int64 {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

// addSaturated adds two counts, stopping at math.MaxInt32 instead of wrapping
// negative: a node's labels come from its cluster's administrators
// (cluster_gpus.go addSaturated).
func addSaturated(a, b int32) int32 {
	if sum := int64(a) + int64(b); sum < math.MaxInt32 {
		return int32(sum)
	}
	return math.MaxInt32
}

// joinVersion joins version parts with dots, stopping at the first missing
// one (cluster_gpus.go joinVersion).
func joinVersion(parts ...string) string {
	out := ""
	for i, p := range parts {
		if p == "" {
			break
		}
		if i > 0 {
			out += "."
		}
		out += p
	}
	return out
}

// gpuNode reads one Search node; ok is false for a node GFD doesn't mark as
// having an NVIDIA GPU (the backend asks Search for those only). The driver and
// CUDA versions fall back to their major, minor and revision labels, and the
// instance type to node.kubernetes.io/instance-type (cluster_gpus.go
// gpuNodeFromLabels).
func gpuNode(n SearchNode) (*aigridv1.GPUNode, bool) {
	l := searchLabels(n.Label)
	if l[gfdPresent] != "true" {
		return nil, false
	}
	node := &aigridv1.GPUNode{
		Name:      n.Name,
		Vendor:    "NVIDIA",
		Product:   l[gfdProduct],
		Count:     atoi32(l[gfdCount]),
		MemoryMib: atoi64(l[gfdMemory]),
		Family:    l[gfdFamily],
		Sharing:   gpuSharing(l),
		Ready:     strings.Contains("; "+n.Condition+";", "; Ready=True;"),
	}
	if major, minor := l[gfdComputeMajor], l[gfdComputeMinor]; major != "" && minor != "" {
		node.ComputeCapability = major + "." + minor
	}
	node.DriverVersion = l[gfdDriverVersion]
	if node.DriverVersion == "" && l[gfdDriverMajor] != "" {
		node.DriverVersion = joinVersion(l[gfdDriverMajor], l[gfdDriverMinor], l[gfdDriverRev])
	}
	node.CudaRuntimeVersion = l[gfdRuntimeVersion]
	if node.CudaRuntimeVersion == "" && l[gfdRuntimeMajor] != "" {
		node.CudaRuntimeVersion = joinVersion(l[gfdRuntimeMajor], l[gfdRuntimeMinor])
	}
	node.InstanceType = l[gfdMachine]
	if node.InstanceType == "" {
		node.InstanceType = l[nodeInstanceType]
	}
	return node, true
}

// gpuSharing reads how a node's GPUs are shared: "mig" when GFD reports the
// MIG strategy single or mixed, else the sharing strategy (none, time-slicing
// or mps). Replicas are at least 1, GFD's value without sharing
// (cluster_gpus.go gpuSharingFromLabels).
func gpuSharing(l map[string]string) *aigridv1.GPUSharing {
	s := &aigridv1.GPUSharing{
		Strategy:   l[gfdSharingStrategy],
		Replicas:   atoi32(l[gfdReplicas]),
		MigCapable: l[gfdMIGCapable] == "true",
	}
	if s.Replicas < 1 {
		s.Replicas = 1
	}
	if m := l[gfdMIGStrategy]; m == "single" || m == "mixed" {
		s.MigStrategy = m
		s.Strategy = "mig"
	}
	return s
}

// configurationKey is what tells two configurations apart
// (cluster_gpus.go gpuSharingKey): the product, its memory and GPUs per node,
// and how they are shared, MIG capability included.
type configurationKey struct {
	vendor, product, strategy, migStrategy string
	memoryMiB                              int64
	perNode, replicas                      int32
	migCapable                             bool
}

// clusterGPUs sums a cluster's GPU nodes into the inventory the backend
// returns (cluster_gpus.go clusterGPUsFromNodes): totals, the nodes by name,
// and the distinct configurations, most nodes first, then by product, then
// most GPUs per node. Nil without GPU nodes.
func clusterGPUs(nodes []*aigridv1.GPUNode) *aigridv1.ClusterGPUs {
	if len(nodes) == 0 {
		return nil
	}
	out := &aigridv1.ClusterGPUs{Nodes: slices.Clone(nodes)}
	slices.SortFunc(out.Nodes, func(a, b *aigridv1.GPUNode) int { return cmp.Compare(a.GetName(), b.GetName()) })
	byKey := map[configurationKey]*aigridv1.GPUConfiguration{}
	for _, n := range out.Nodes {
		out.Total = addSaturated(out.Total, n.GetCount())
		out.NodeCount++
		sh := n.GetSharing()
		key := configurationKey{
			vendor: n.GetVendor(), product: n.GetProduct(), memoryMiB: n.GetMemoryMib(), perNode: n.GetCount(),
			strategy: sh.GetStrategy(), migStrategy: sh.GetMigStrategy(), replicas: sh.GetReplicas(), migCapable: sh.GetMigCapable(),
		}
		c := byKey[key]
		if c == nil {
			c = &aigridv1.GPUConfiguration{
				Vendor: n.GetVendor(), Product: n.GetProduct(), MemoryMib: n.GetMemoryMib(),
				GpusPerNode: n.GetCount(), Sharing: proto.Clone(sh).(*aigridv1.GPUSharing),
			}
			byKey[key] = c
			out.Configurations = append(out.Configurations, c)
		}
		c.NodeCount++
	}
	slices.SortStableFunc(out.Configurations, func(a, b *aigridv1.GPUConfiguration) int {
		return cmp.Or(
			cmp.Compare(b.GetNodeCount(), a.GetNodeCount()),
			cmp.Compare(a.GetProduct(), b.GetProduct()),
			cmp.Compare(b.GetGpusPerNode(), a.GetGpusPerNode()),
		)
	})
	return out
}

// gpusByCluster reads the Search nodes into each cluster's inventory.
func gpusByCluster(nodes []SearchNode) map[string]*aigridv1.ClusterGPUs {
	grouped := map[string][]*aigridv1.GPUNode{}
	for _, n := range nodes {
		if g, ok := gpuNode(n); ok {
			grouped[n.Cluster] = append(grouped[n.Cluster], g)
		}
	}
	out := map[string]*aigridv1.ClusterGPUs{}
	for cluster, ns := range grouped {
		out[cluster] = clusterGPUs(ns)
	}
	return out
}
