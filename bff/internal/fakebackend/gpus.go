package fakebackend

import (
	"cmp"
	"fmt"
	"slices"
	"strconv"
	"strings"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// SearchNode is one `kind=Node` item as ACM Search (search-v2, the
// search-search-api GraphQL `search` query) returns it: the cluster, the node
// name, every node label as one "key=value; key=value" string, and the
// conditions as "Type=Status; ...". That is where the hub sees a spoke's GPUs:
// ManagedClusterInfo keeps no NVIDIA GPU Feature Discovery labels (dev hub
// hf299, 2026-10-26). The real backend reads these items from Search; the fake
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
	gfdRuntimeVersion  = "nvidia.com/cuda.runtime-version.full"
	gfdMachine         = "nvidia.com/gpu.machine"
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

func atoiOr(s string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return v
	}
	return def
}

// gpuNode reads one Search node; ok is false for a node GFD doesn't mark as
// having an NVIDIA GPU.
func gpuNode(n SearchNode) (*aigridv1.GPUNode, bool) {
	l := searchLabels(n.Label)
	if l[gfdPresent] != "true" {
		return nil, false
	}
	compute := ""
	if major, minor := l[gfdComputeMajor], l[gfdComputeMinor]; major != "" && minor != "" {
		compute = major + "." + minor
	}
	return &aigridv1.GPUNode{
		Name:               n.Name,
		Vendor:             "NVIDIA",
		Product:            l[gfdProduct],
		Count:              int32(atoiOr(l[gfdCount], 0)),
		MemoryMib:          int64(atoiOr(l[gfdMemory], 0)),
		Family:             l[gfdFamily],
		ComputeCapability:  compute,
		DriverVersion:      l[gfdDriverVersion],
		CudaRuntimeVersion: l[gfdRuntimeVersion],
		Sharing:            gpuSharing(l),
		InstanceType:       l[gfdMachine],
		Ready:              strings.Contains("; "+n.Condition+";", "; Ready=True;"),
	}, true
}

// gpuSharing reads how a node's GPUs are shared: MIG when GFD reports a MIG
// strategy other than none, else the sharing strategy (none, time-slicing or
// mps), with the replicas per GPU (1 without sharing).
func gpuSharing(l map[string]string) *aigridv1.GPUSharing {
	s := &aigridv1.GPUSharing{
		Strategy:   l[gfdSharingStrategy],
		Replicas:   int32(atoiOr(l[gfdReplicas], 1)),
		MigCapable: l[gfdMIGCapable] == "true",
	}
	if mig := l[gfdMIGStrategy]; mig != "" && mig != "none" {
		s.Strategy, s.MigStrategy = "mig", mig
	}
	return s
}

// clusterGPUs sums a cluster's GPU nodes into the inventory the backend
// returns: totals, the distinct configurations (most nodes first, then by
// product) and the nodes by name. Nil without GPU nodes.
func clusterGPUs(nodes []*aigridv1.GPUNode) *aigridv1.ClusterGPUs {
	if len(nodes) == 0 {
		return nil
	}
	out := &aigridv1.ClusterGPUs{}
	byKey := map[string]*aigridv1.GPUConfiguration{}
	for _, n := range nodes {
		out.Total += n.GetCount()
		out.NodeCount++
		sh := n.GetSharing()
		key := fmt.Sprintf("%s|%s|%d|%d|%s|%d|%s", n.GetVendor(), n.GetProduct(), n.GetMemoryMib(), n.GetCount(),
			sh.GetStrategy(), sh.GetReplicas(), sh.GetMigStrategy())
		if c, ok := byKey[key]; ok {
			c.NodeCount++
			continue
		}
		c := &aigridv1.GPUConfiguration{
			Vendor: n.GetVendor(), Product: n.GetProduct(), MemoryMib: n.GetMemoryMib(),
			GpusPerNode: n.GetCount(), NodeCount: 1, Sharing: sh,
		}
		byKey[key] = c
		out.Configurations = append(out.Configurations, c)
	}
	slices.SortStableFunc(out.Configurations, func(a, b *aigridv1.GPUConfiguration) int {
		return cmp.Or(cmp.Compare(b.GetNodeCount(), a.GetNodeCount()), cmp.Compare(a.GetProduct(), b.GetProduct()))
	})
	out.Nodes = slices.Clone(nodes)
	slices.SortFunc(out.Nodes, func(a, b *aigridv1.GPUNode) int { return cmp.Compare(a.GetName(), b.GetName()) })
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
