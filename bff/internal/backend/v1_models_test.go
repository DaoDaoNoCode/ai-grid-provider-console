package backend

import (
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

const modelsNS = "models-as-a-service"

var modelCreated = timestamppb.New(time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC))

// v1Model is a stored model placed on two clusters, as the backend answers it.
func v1Model() *backendv1.Model {
	return &backendv1.Model{
		Id: "granite",
		Metadata: &backendv1.Metadata{
			Name: "granite", Version: 3, CreationTimestamp: modelCreated,
			Labels: map[string]string{"k": "v"}, Annotations: map[string]string{annotationDisplayName: "Granite"},
		},
		Spec: &backendv1.ModelSpec{
			Model:    &backendv1.ModelSource{Uri: "hf://ibm/granite", Name: "granite"},
			Replicas: proto.Int32(1),
			BaseRefs: []string{"preset"},
			Router:   &backendv1.ModelRouter{ManagedRoute: true, GatewayRefs: []*backendv1.ModelGatewayRef{{Name: "gw", Namespace: "openshift-ingress"}}},
			Main: &backendv1.ModelContainer{
				Image: "vllm", Requests: map[string]string{"cpu": "2"}, Limits: map[string]string{"memory": "8Gi"},
				Env: []*backendv1.ModelEnvVar{{Name: "VLLM_ADDITIONAL_ARGS", Value: "--x"}},
			},
			Placement: &backendv1.ModelPlacement{LabelSelector: &backendv1.ModelLabelSelector{
				MatchExpressions: []*backendv1.ModelLabelSelectorRequirement{{Key: "name", Operator: "In", Values: []string{"site-b", "site-a"}}},
			}},
		},
		Status: &backendv1.ModelStatus{
			Phase: backendv1.ModelPhase_MODEL_PHASE_PENDING, Reason: "SavedToGit",
			// Two clusters at one location: locations are `location` labels, not cluster names.
			Placement: &backendv1.ModelPlacementStatus{NumberOfSelectedClusters: 2, SelectedClusters: []string{"site-b", "site-a"}, Locations: []string{"us-east"}},
		},
	}
}

// draftModel is v1Model in the draft, as the console reads it.
func draftModel() *aigridv1.Model {
	return &aigridv1.Model{
		Name: "granite",
		Metadata: &aigridv1.ObjectMeta{
			Namespace: modelsNS, ResourceVersion: "3", CreationTimestamp: modelCreated,
			Labels: map[string]string{"k": "v"}, Annotations: map[string]string{annotationDisplayName: "Granite"},
		},
		Spec: &aigridv1.ModelSpec{
			Model:    &aigridv1.ModelSource{Uri: "hf://ibm/granite", Name: "granite"},
			Replicas: proto.Int32(1),
			BaseRefs: []string{"preset"},
			Router:   &aigridv1.Router{ManagedRoute: true, GatewayRefs: []*aigridv1.GatewayRef{{Name: "gw", Namespace: "openshift-ingress"}}},
			Main: &aigridv1.Container{
				Image: "vllm", Requests: map[string]string{"cpu": "2"}, Limits: map[string]string{"memory": "8Gi"},
				Env: []*aigridv1.EnvVar{{Name: "VLLM_ADDITIONAL_ARGS", Value: "--x"}},
			},
			Placement: &aigridv1.Placement{LabelSelector: &aigridv1.LabelSelector{
				MatchExpressions: []*aigridv1.LabelSelectorRequirement{{Key: "name", Operator: "In", Values: []string{"site-b", "site-a"}}},
			}},
		},
		Status: &aigridv1.ModelStatus{
			Phase: aigridv1.ModelPhase_MODEL_PHASE_PENDING, Reason: "SavedToGit",
			Placement: &aigridv1.PlacementStatus{
				NumberOfSelectedClusters: 2, Locations: []string{"us-east"},
				Decisions: []*aigridv1.ClusterDecision{{ClusterName: "site-a"}, {ClusterName: "site-b"}},
			},
		},
	}
}

func TestV1ModelReads(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	conn := &recordingConn{reply: &backendv1.ModelsListResponse{Size: 1, Total: 4, Items: []*backendv1.Model{v1Model()}}}
	list, err := v1Models{conn, modelsNS}.ListModels(ctx, &aigridv1.ListModelsRequest{Offset: proto.Int32(3), Limit: proto.Int32(1)})
	if err != nil || conn.method != methodModelsList {
		t.Fatalf("List sent %s: %v", conn.method, err)
	}
	if sent := conn.req.(*backendv1.ModelsListRequest); sent.GetOffset() != 3 || sent.GetLimit() != 1 {
		t.Errorf("List sent %v, want offset 3 and limit 1", sent)
	}
	if list.GetTotal() != 4 || len(list.GetItems()) != 1 || !proto.Equal(list.GetItems()[0], draftModel()) {
		t.Fatalf("List got %v, want %v", list, draftModel())
	}

}

// The draft's filter and order use its own field names, which the backend's
// List doesn't have.
func TestV1ModelRefusals(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	c := v1Models{&recordingConn{}, modelsNS}
	if _, err := c.ListModels(ctx, &aigridv1.ListModelsRequest{Filter: proto.String("true")}); status.Code(err) != codes.Unimplemented {
		t.Errorf("List with a filter: %v, want Unimplemented", err)
	}
}
