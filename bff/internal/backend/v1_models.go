package backend

// Stopgap: the backend's real Models/List behind the draft's ListModels, for
// GET /api/v1/models, which only the Subscriptions pages still read; the Models
// pages call the backend's Models API over Connect.
//
// The backend's models have an id and no namespace: it keeps every model in one
// namespace of its own. The draft's namespace is the BFF's configured models
// namespace (--models-namespace), which the list gives back.

import (
	"context"
	"slices"
	"strconv"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	backendv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/backend/v1"
	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

type v1Models struct {
	conn      grpc.ClientConnInterface
	namespace string
}

var _ ModelLister = v1Models{}

// ListModels forwards offset and limit. The backend's ModelsListRequest has a
// filter over its own field names (id, no namespace), so a draft filter is
// Unimplemented, and so is an order: the draft supports only its default.
func (c v1Models) ListModels(ctx context.Context, in *aigridv1.ListModelsRequest, opts ...grpc.CallOption) (*aigridv1.ListModelsResponse, error) {
	if in.Filter != nil || in.GetOrder() != "" {
		return nil, status.Error(codes.Unimplemented, "the backend's Models API does not take the console's filter or order")
	}
	resp := &backendv1.ModelsListResponse{}
	if err := c.conn.Invoke(ctx, methodModelsList, &backendv1.ModelsListRequest{Offset: in.Offset, Limit: in.Limit}, resp, opts...); err != nil {
		return nil, err
	}
	out := &aigridv1.ListModelsResponse{Size: resp.GetSize(), Total: proto.Int32(resp.GetTotal())}
	for _, m := range resp.GetItems() {
		out.Items = append(out.Items, c.fromV1(m))
	}
	return out, nil
}

func (c v1Models) fromV1(m *backendv1.Model) *aigridv1.Model {
	meta, spec := m.GetMetadata(), m.GetSpec()
	out := &aigridv1.Model{
		Name: m.GetId(),
		Metadata: &aigridv1.ObjectMeta{
			Namespace:         c.namespace,
			ResourceVersion:   strconv.Itoa(int(meta.GetVersion())),
			Labels:            meta.GetLabels(),
			Annotations:       meta.GetAnnotations(),
			CreationTimestamp: meta.GetCreationTimestamp(),
			DeletionTimestamp: meta.GetDeletionTimestamp(),
		},
		Status: fromV1ModelStatus(m.GetStatus()),
	}
	if spec == nil {
		return out
	}
	out.Spec = &aigridv1.ModelSpec{Replicas: spec.Replicas, BaseRefs: spec.GetBaseRefs(), Runtime: spec.GetRuntime()}
	if src := spec.GetModel(); src != nil {
		out.Spec.Model = &aigridv1.ModelSource{Uri: src.GetUri(), Name: src.GetName()}
	}
	if r := spec.GetRouter(); r != nil {
		out.Spec.Router = &aigridv1.Router{ManagedRoute: r.GetManagedRoute(), Scheduler: r.GetScheduler()}
		for _, g := range r.GetGatewayRefs() {
			out.Spec.Router.GatewayRefs = append(out.Spec.Router.GatewayRefs, &aigridv1.GatewayRef{Name: g.GetName(), Namespace: g.GetNamespace(), SectionName: g.GetSectionName()})
		}
	}
	if ct := spec.GetMain(); ct != nil {
		out.Spec.Main = &aigridv1.Container{Image: ct.GetImage(), Requests: ct.GetRequests(), Limits: ct.GetLimits()}
		for _, e := range ct.GetEnv() {
			out.Spec.Main.Env = append(out.Spec.Main.Env, &aigridv1.EnvVar{Name: e.GetName(), Value: e.GetValue()})
		}
	}
	if s := spec.GetScaling(); s != nil {
		out.Spec.Scaling = &aigridv1.Scaling{MinReplicas: s.GetMinReplicas(), MaxReplicas: s.GetMaxReplicas(), Keda: s.GetKeda()}
		for _, t := range s.GetTriggers() {
			out.Spec.Scaling.Triggers = append(out.Spec.Scaling.Triggers, &aigridv1.KedaTrigger{Type: t.GetType(), Metadata: t.GetMetadata()})
		}
	}
	if p := spec.GetPlacement(); p != nil {
		out.Spec.Placement = fromV1Placement(p)
	}
	if r := spec.GetRollout(); r != nil {
		out.Spec.Rollout = &aigridv1.Rollout{
			Strategy:       aigridv1.RolloutStrategy(r.GetStrategy()),
			MaxConcurrency: r.GetMaxConcurrency(), MaxFailures: r.GetMaxFailures(),
			ProgressDeadline: r.GetProgressDeadline(), MinSuccessTime: r.GetMinSuccessTime(),
		}
	}
	return out
}

// fromV1Placement maps the placement as the backend stores it.
func fromV1Placement(p *backendv1.ModelPlacement) *aigridv1.Placement {
	out := &aigridv1.Placement{ClusterSets: p.GetClusterSets(), NumberOfClusters: p.NumberOfClusters}
	sel := p.GetLabelSelector()
	if sel == nil {
		return out
	}
	out.LabelSelector = &aigridv1.LabelSelector{MatchLabels: sel.GetMatchLabels()}
	for _, r := range sel.GetMatchExpressions() {
		out.LabelSelector.MatchExpressions = append(out.LabelSelector.MatchExpressions, &aigridv1.LabelSelectorRequirement{Key: r.GetKey(), Operator: r.GetOperator(), Values: r.GetValues()})
	}
	return out
}

// fromV1ModelStatus maps the status: the selected clusters are the decisions,
// and the locations are their `location` labels, as the backend reports them.
func fromV1ModelStatus(st *backendv1.ModelStatus) *aigridv1.ModelStatus {
	if st == nil {
		return nil
	}
	out := &aigridv1.ModelStatus{
		Url:                st.GetUrl(),
		Conditions:         fromV1Conditions(st.GetConditions()),
		Phase:              aigridv1.ModelPhase(st.GetPhase()),
		Reason:             st.GetReason(),
		Message:            st.GetMessage(),
		ObservedGeneration: st.GetObservedGeneration(),
	}
	if ps := st.GetPlacement(); ps != nil {
		selected := slices.Clone(ps.GetSelectedClusters())
		slices.Sort(selected)
		selected = slices.Compact(selected)
		out.Placement = &aigridv1.PlacementStatus{
			NumberOfSelectedClusters: ps.GetNumberOfSelectedClusters(),
			Conditions:               fromV1Conditions(ps.GetConditions()),
			Locations:                ps.GetLocations(),
		}
		for _, name := range selected {
			out.Placement.Decisions = append(out.Placement.Decisions, &aigridv1.ClusterDecision{ClusterName: name})
		}
	}
	if rs := st.GetRollout(); rs != nil {
		out.Rollout = &aigridv1.RolloutStatus{Conditions: fromV1Conditions(rs.GetConditions())}
	}
	return out
}
