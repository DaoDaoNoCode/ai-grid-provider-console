package api

import (
	"math"
	"strconv"
	"strings"
	"time"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Labels on a ManagedCluster that the console reads. They are the conventions
// from the provider portal POC: `ai-grid/*` marks grid membership and site
// identity, `location` drives model placement.
const (
	LabelEnabled     = "ai-grid/enabled"
	LabelProvisioned = "ai-grid/provisioned"
	LabelLocation    = "location"
	LabelSite        = "ai-grid/site"
	LabelRegion      = "ai-grid/region"
	// LabelOpenShiftVersion is set by ACM on every ManagedCluster.
	LabelOpenShiftVersion = "openshiftVersion"
	// LabelAddonPrefix is the prefix of the labels ACM writes per add-on,
	// valued available|unhealthy|unreachable.
	LabelAddonPrefix = "feature.open-cluster-management.io/addon-"
)

// Annotations the console writes for the map.
const (
	AnnotationSiteName  = "ai-grid/site-name"
	AnnotationLatitude  = "ai-grid/latitude"
	AnnotationLongitude = "ai-grid/longitude"
)

// Cluster claims the console reads (`status.clusterClaims[]`).
const (
	ClaimConsoleURL = "consoleurl.cluster.open-cluster-management.io"
	ClaimPlatform   = "platform.open-cluster-management.io"
	ClaimProduct    = "product.open-cluster-management.io"
	// CapacityGPU is the resource name the NVIDIA device plugin advertises.
	CapacityGPU = "nvidia.com/gpu"
)

// Cluster status strings, lowercase like the ACM console shows them.
const (
	StatusReady         = "ready"
	StatusOffline       = "offline"
	StatusUnknown       = "unknown"
	StatusPendingImport = "pendingimport"
	StatusImporting     = "importing"
	StatusImportFailed  = "importfailed"
	StatusDetaching     = "detaching"
	StatusNotAccepted   = "notaccepted"
)

// GridCluster is a ManagedCluster as the console shows it.
type GridCluster struct {
	Name             string `json:"name"`
	AIGridEnabled    bool   `json:"aiGridEnabled"`
	Provisioned      bool   `json:"provisioned"`
	HubAcceptsClient bool   `json:"hubAcceptsClient"`
	Location         string `json:"location,omitempty"`
	Site             string `json:"site,omitempty"`
	Region           string `json:"region,omitempty"`
	OpenShiftVersion string `json:"openshiftVersion,omitempty"`
	// Status is the lifecycle state the backend derived from the conditions,
	// one of ready|offline|unknown|pendingimport|importing|importfailed|
	// detaching|notaccepted; empty when the backend reports none.
	Status        string `json:"status,omitempty"`
	StatusMessage string `json:"statusMessage,omitempty"`
	// ConsoleURL, KubernetesVersion, Platform and Product come from the
	// claims and the status the agent reports.
	ConsoleURL        string `json:"consoleUrl,omitempty"`
	KubernetesVersion string `json:"kubernetesVersion,omitempty"`
	Platform          string `json:"platform,omitempty"`
	Product           string `json:"product,omitempty"`
	// GPUCapacity is `status.capacity["nvidia.com/gpu"]`, zero when absent.
	// Device plugins advertise GPUs as plain integers; other Kubernetes
	// quantity spellings ("8k", "1e1") are not parsed and read as zero.
	GPUCapacity int `json:"gpuCapacity"`
	// Capacity and Allocatable are `status.capacity` and `status.allocatable`
	// as the backend sends them, Kubernetes quantity strings keyed by resource
	// name; omitted when the backend reports none.
	Capacity    map[string]string `json:"capacity,omitempty"`
	Allocatable map[string]string `json:"allocatable,omitempty"`
	// GPUs is the backend's `status.gpus`, as it sends it: the cluster's GPU
	// inventory from ACM Search. Omitted when the backend has none for the
	// cluster (no GPU nodes, or Search unavailable); `gpuCapacity` still counts
	// the schedulable GPUs then.
	GPUs *ClusterGPUs `json:"gpus,omitempty"`
	// CreationTimestamp is when the hub created the ManagedCluster.
	CreationTimestamp *time.Time `json:"creationTimestamp,omitempty"`
	// SiteName, Latitude and Longitude come from the `ai-grid/*` annotations.
	SiteName  string   `json:"siteName,omitempty"`
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
	// Addons maps an add-on name to available|unhealthy|unreachable.
	Addons          map[string]string  `json:"addons"`
	Conditions      []ClusterCondition `json:"conditions"`
	ResourceVersion string             `json:"resourceVersion,omitempty"`
	Labels          map[string]string  `json:"labels"`
	Annotations     map[string]string  `json:"annotations"`
}

// ClusterGPUs is the backend's ClusterGPUs in the console's JSON: the
// field names in lowerCamelCase, nothing derived here.
type ClusterGPUs struct {
	Total          int32              `json:"total"`
	NodeCount      int32              `json:"nodeCount"`
	Configurations []GPUConfiguration `json:"configurations"`
	Nodes          []GPUNode          `json:"nodes"`
}

// GPUConfiguration is the backend's GPUConfiguration: nodes that share one.
type GPUConfiguration struct {
	Vendor      string     `json:"vendor"`
	Product     string     `json:"product"`
	MemoryMiB   int64      `json:"memoryMib"`
	GPUsPerNode int32      `json:"gpusPerNode"`
	NodeCount   int32      `json:"nodeCount"`
	Sharing     GPUSharing `json:"sharing"`
}

// GPUSharing is the backend's GPUSharing: how a node's GPUs are shared or sliced.
type GPUSharing struct {
	Strategy    string `json:"strategy"`
	Replicas    int32  `json:"replicas"`
	MIGCapable  bool   `json:"migCapable"`
	MIGStrategy string `json:"migStrategy,omitempty"`
}

// GPUNode is the backend's GPUNode: one node with GPUs.
type GPUNode struct {
	Name               string     `json:"name"`
	Vendor             string     `json:"vendor"`
	Product            string     `json:"product"`
	Count              int32      `json:"count"`
	MemoryMiB          int64      `json:"memoryMib"`
	Family             string     `json:"family,omitempty"`
	ComputeCapability  string     `json:"computeCapability,omitempty"`
	DriverVersion      string     `json:"driverVersion,omitempty"`
	CUDARuntimeVersion string     `json:"cudaRuntimeVersion,omitempty"`
	Sharing            GPUSharing `json:"sharing"`
	InstanceType       string     `json:"instanceType,omitempty"`
	Ready              bool       `json:"ready"`
}

func toGPUSharing(s *aigridv1.GPUSharing) GPUSharing {
	return GPUSharing{
		Strategy: s.GetStrategy(), Replicas: s.GetReplicas(),
		MIGCapable: s.GetMigCapable(), MIGStrategy: s.GetMigStrategy(),
	}
}

// toClusterGPUs copies the backend's inventory into the JSON; nil stays nil.
func toClusterGPUs(g *aigridv1.ClusterGPUs) *ClusterGPUs {
	if g == nil {
		return nil
	}
	out := &ClusterGPUs{
		Total: g.GetTotal(), NodeCount: g.GetNodeCount(),
		Configurations: make([]GPUConfiguration, 0, len(g.GetConfigurations())),
		Nodes:          make([]GPUNode, 0, len(g.GetNodes())),
	}
	for _, c := range g.GetConfigurations() {
		out.Configurations = append(out.Configurations, GPUConfiguration{
			Vendor: c.GetVendor(), Product: c.GetProduct(), MemoryMiB: c.GetMemoryMib(),
			GPUsPerNode: c.GetGpusPerNode(), NodeCount: c.GetNodeCount(), Sharing: toGPUSharing(c.GetSharing()),
		})
	}
	for _, n := range g.GetNodes() {
		out.Nodes = append(out.Nodes, GPUNode{
			Name: n.GetName(), Vendor: n.GetVendor(), Product: n.GetProduct(), Count: n.GetCount(),
			MemoryMiB: n.GetMemoryMib(), Family: n.GetFamily(), ComputeCapability: n.GetComputeCapability(),
			DriverVersion: n.GetDriverVersion(), CUDARuntimeVersion: n.GetCudaRuntimeVersion(),
			Sharing: toGPUSharing(n.GetSharing()), InstanceType: n.GetInstanceType(), Ready: n.GetReady(),
		})
	}
	return out
}

// ClusterCondition is one `status.conditions[]` entry with the Kubernetes
// status spelling (True, False, Unknown). LastTransitionTime is omitted when
// the hub recorded none, rather than shown as the Unix epoch.
type ClusterCondition struct {
	Type               string     `json:"type"`
	Status             string     `json:"status"`
	Reason             string     `json:"reason,omitempty"`
	Message            string     `json:"message,omitempty"`
	LastTransitionTime *time.Time `json:"lastTransitionTime,omitempty"`
}

// stateStrings maps the backend's enum to the ACM console's words.
var stateStrings = map[aigridv1.ManagedClusterState]string{
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_AVAILABLE:      StatusReady,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNAVAILABLE:    StatusOffline,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_UNKNOWN:        StatusUnknown,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_PENDING:        StatusPendingImport,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_PENDING_IMPORT: StatusPendingImport,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_IMPORTING:      StatusImporting,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_IMPORT_FAILED:  StatusImportFailed,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_DETACHING:      StatusDetaching,
	aigridv1.ManagedClusterState_MANAGED_CLUSTER_STATE_NOT_ACCEPTED:   StatusNotAccepted,
}

var conditionStatusStrings = map[aigridv1.ConditionStatus]string{
	aigridv1.ConditionStatus_CONDITION_STATUS_TRUE:        "True",
	aigridv1.ConditionStatus_CONDITION_STATUS_FALSE:       "False",
	aigridv1.ConditionStatus_CONDITION_STATUS_UNSPECIFIED: "Unknown",
}

func toGridCluster(mc *aigridv1.ManagedCluster) GridCluster {
	labels := mc.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	annotations := mc.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	st := mc.GetStatus()
	claims := map[string]string{}
	for _, c := range st.GetClusterClaims() {
		claims[c.GetName()] = c.GetValue()
	}
	addons := map[string]string{}
	for k, v := range labels {
		if name, ok := strings.CutPrefix(k, LabelAddonPrefix); ok && name != "" {
			addons[name] = v
		}
	}
	gpu, _ := strconv.Atoi(st.GetCapacity()[CapacityGPU])
	provisioned := labels[LabelProvisioned] == "true"
	var created *time.Time
	if ts := mc.GetCreationTimestamp(); ts != nil {
		t := ts.AsTime().UTC()
		created = &t
	}
	if st != nil && st.Provisioning != nil {
		provisioned = st.GetProvisioning() == "Compliant"
	}
	return GridCluster{
		Name:              mc.GetName(),
		AIGridEnabled:     labels[LabelEnabled] == "true",
		Provisioned:       provisioned,
		HubAcceptsClient:  mc.GetHubAcceptsClient(),
		Location:          labels[LabelLocation],
		Site:              labels[LabelSite],
		Region:            labels[LabelRegion],
		OpenShiftVersion:  labels[LabelOpenShiftVersion],
		Status:            stateStrings[st.GetState()],
		StatusMessage:     st.GetStateMessage(),
		ConsoleURL:        claims[ClaimConsoleURL],
		KubernetesVersion: st.GetKubernetesVersion(),
		Platform:          claims[ClaimPlatform],
		Product:           claims[ClaimProduct],
		GPUCapacity:       gpu,
		Capacity:          st.GetCapacity(),
		Allocatable:       st.GetAllocatable(),
		GPUs:              toClusterGPUs(st.GetGpus()),
		CreationTimestamp: created,
		SiteName:          annotations[AnnotationSiteName],
		Latitude:          parseCoordinate(annotations[AnnotationLatitude], 90),
		Longitude:         parseCoordinate(annotations[AnnotationLongitude], 180),
		Addons:            addons,
		Conditions:        toConditions(st.GetConditions()),
		ResourceVersion:   mc.GetResourceVersion(),
		Labels:            labels,
		Annotations:       annotations,
	}
}

// parseCoordinate reads an annotation as a finite number within
// [-limit, limit]; absent or invalid values are omitted rather than shown as
// zero. ParseFloat accepts "NaN" and "Inf", which JSON cannot encode, so they
// are rejected explicitly: one bad annotation must not break the whole list.
func parseCoordinate(s string, limit float64) *float64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < -limit || v > limit {
		return nil
	}
	return &v
}
