package fakebackend

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
)

// Strings the hub's placement controller writes on a Placement and a
// PlacementDecision (cluster.open-cluster-management.io/v1beta1). Every value
// comes from mock/research/acm.md section 3, which cites
// ocm:pkg/placement/controllers/scheduling for each one. Keep them verbatim.
const (
	CondPlacementSatisfied     = "PlacementSatisfied"
	CondPlacementMisconfigured = "PlacementMisconfigured"

	// PlacementSatisfied.
	ReasonAllDecisionsScheduled         = "AllDecisionsScheduled"
	MessageAllDecisionsScheduled        = "All cluster decisions scheduled"
	ReasonNotAllDecisionsScheduled      = "NotAllDecisionsScheduled"
	MessageNotAllDecisionsScheduledFm   = "%d cluster decisions unscheduled"
	ReasonNoManagedClusterSetBindings   = "NoManagedClusterSetBindings"
	MessageNoManagedClusterSetBindings  = "No valid ManagedClusterSetBindings found in placement namespace"
	ReasonNoIntersection                = "NoIntersection"
	MessageNoIntersectionFm             = "None of ManagedClusterSets %s is bound to placement namespace"
	ReasonAllManagedClusterSetsEmpty    = "AllManagedClusterSetsEmpty"
	MessageAllManagedClusterSetsEmptyFm = "All ManagedClusterSets %s have no member ManagedCluster"
	ReasonNoManagedClusterMatched       = "NoManagedClusterMatched"
	MessageNoManagedClusterMatched      = "No ManagedCluster matches any of the cluster predicate"

	// PlacementMisconfigured, always False in the fake (no prioritizer or
	// decision-group plugin is configured that could fail).
	ReasonSucceedconfigured  = "Succeedconfigured"
	MessageSucceedconfigured = "Placement configurations check pass"

	// Built-in ManagedClusterSets (acm.md section 2): `global` selects every
	// cluster (LabelSelector {}), `default` the clusters whose
	// `cluster.open-cluster-management.io/clusterset` label is `default`
	// (ExclusiveClusterSetLabel).
	ClusterSetGlobal  = "global"
	ClusterSetDefault = "default"

	// Selector operators (metav1.LabelSelectorRequirement; the claim selector
	// uses the same set).
	OperatorIn           = "In"
	OperatorNotIn        = "NotIn"
	OperatorExists       = "Exists"
	OperatorDoesNotExist = "DoesNotExist"

	// Toleration operators; the CRD defaults an omitted operator to Equal.
	TolerationEqual  = "Equal"
	TolerationExists = "Exists"

	// LabelModel marks the Placement and the ManifestWorkReplicaSet of a model
	// (acm.md "Proposal": `ai-grid/model=<name>`); the objects are named
	// `model-<name>` in the model's namespace.
	// Its PlacementDecision is `model-<name>-decision-1`, and on create the
	// backend adds only the CRD defaults `scoreRateLimit: 1m` and
	// `sortBy: ClusterName`, neither of which the console's Placement message
	// carries.
	LabelModel          = "ai-grid/model"
	placementNamePrefix = "model-"
)

// knownOperators are the selector operators the fake evaluates.
var knownOperators = map[string]bool{OperatorIn: true, OperatorNotIn: true, OperatorExists: true, OperatorDoesNotExist: true}

// knownClusterSets are the ManagedClusterSets that exist on the hub.
var knownClusterSets = map[string]bool{ClusterSetGlobal: true, ClusterSetDefault: true}

// placementName is the name of a model's Placement and ManifestWorkReplicaSet.
func placementName(model string) string { return placementNamePrefix + model }

// matchRequirement evaluates one In/NotIn/Exists/DoesNotExist requirement
// against a key/value map, with Kubernetes semantics: NotIn and DoesNotExist
// match when the key is absent.
func matchRequirement(values map[string]string, key, operator string, wanted []string) bool {
	v, present := values[key]
	switch operator {
	case OperatorIn:
		return present && slices.Contains(wanted, v)
	case OperatorNotIn:
		return !present || !slices.Contains(wanted, v)
	case OperatorExists:
		return present
	case OperatorDoesNotExist:
		return !present
	}
	return false
}

// matchesPredicate is the one predicate's requiredClusterSelector: every
// matchLabels entry, every label expression and every claim expression must
// hold (AND inside a predicate, acm.md section 3).
func matchesPredicate(p *aigridv1.Placement, c *aigridv1.ManagedCluster) bool {
	labels := c.GetLabels()
	for k, v := range p.GetLabelSelector().GetMatchLabels() {
		// A matchLabels entry needs the key present with that exact value; an
		// empty value matches an empty label, never an absent one.
		if lv, ok := labels[k]; !ok || lv != v {
			return false
		}
	}
	for _, req := range p.GetLabelSelector().GetMatchExpressions() {
		if !matchRequirement(labels, req.GetKey(), req.GetOperator(), req.GetValues()) {
			return false
		}
	}
	if len(p.GetClaimExpressions()) > 0 {
		claims := map[string]string{}
		for _, cl := range c.GetStatus().GetClusterClaims() {
			claims[cl.GetName()] = cl.GetValue()
		}
		for _, req := range p.GetClaimExpressions() {
			if !matchRequirement(claims, req.GetKey(), req.GetOperator(), req.GetValues()) {
				return false
			}
		}
	}
	return true
}

// tolerated reports whether the cluster's NoSelect taints are all tolerated
// at `now`: a toleration matches by key (and value for Equal) and effect, and
// an expired `tolerationSeconds`, counted from the taint's `timeAdded`, no
// longer tolerates (acm.md section 3). Both times are scenario time.
func tolerated(p *aigridv1.Placement, c *aigridv1.ManagedCluster, now time.Time, toScenario func(time.Time) time.Time) bool {
	for _, taint := range c.GetTaints() {
		if taint.GetEffect() != TaintNoSelect {
			continue
		}
		ok := false
		for _, tol := range p.GetTolerations() {
			if tol.GetKey() != taint.GetKey() || (tol.GetEffect() != "" && tol.GetEffect() != taint.GetEffect()) {
				continue
			}
			if op := tol.GetOperator(); op != TolerationExists && tol.GetValue() != taint.GetValue() {
				continue // Equal (the default)
			}
			if tol.TolerationSeconds != nil && taint.GetTimeAdded() != nil {
				expires := toScenario(taint.GetTimeAdded().AsTime()).Add(time.Duration(tol.GetTolerationSeconds()) * time.Second)
				if !now.Before(expires) {
					continue
				}
			}
			ok = true
			break
		}
		if !ok {
			return false
		}
	}
	return true
}

// inClusterSet reports membership in a built-in set.
func inClusterSet(set string, c *aigridv1.ManagedCluster) bool {
	switch set {
	case ClusterSetGlobal:
		return true
	case ClusterSetDefault:
		return c.GetLabels()[LabelClusterSet] == ClusterSetDefault
	}
	return false
}

// bracketList formats names the way the scheduling controller does in its
// messages: `[a,b]`.
func bracketList(names []string) string { return "[" + strings.Join(names, ",") + "]" }

// computePlacement is the scheduling controller's decision for one Placement
// (acm.md section 3 and "What the fake backend must simulate" item 6): clusters
// of the bound sets, filtered by the predicate, by tolerated taints and by not
// terminating, sorted by name and capped at numberOfClusters. `bound` are the
// ManagedClusterSets bound into the namespace; `now` is scenario time.
func computePlacement(p *aigridv1.Placement, bound []string, clusters map[string]*aigridv1.ManagedCluster, now time.Time, toScenario func(time.Time) time.Time) *aigridv1.PlacementStatus {
	st := &aigridv1.PlacementStatus{}
	st.Conditions = writeCondition(st.Conditions, now, CondPlacementMisconfigured, cFalse, ReasonSucceedconfigured, MessageSucceedconfigured)
	satisfied := func(status aigridv1.ConditionStatus, reason, message string) *aigridv1.PlacementStatus {
		st.Conditions = writeCondition(st.Conditions, now, CondPlacementSatisfied, status, reason, message)
		return st
	}
	if len(bound) == 0 {
		return satisfied(cFalse, ReasonNoManagedClusterSetBindings, MessageNoManagedClusterSetBindings)
	}
	sets := p.GetClusterSets()
	if len(sets) == 0 {
		sets = bound // empty = all bound sets
	}
	var usable []string
	for _, set := range sets {
		if slices.Contains(bound, set) && knownClusterSets[set] {
			usable = append(usable, set)
		}
	}
	if len(usable) == 0 {
		return satisfied(cFalse, ReasonNoIntersection, fmt.Sprintf(MessageNoIntersectionFm, bracketList(sets)))
	}
	var members []*aigridv1.ManagedCluster
	for _, c := range clusters {
		for _, set := range usable {
			if inClusterSet(set, c) {
				members = append(members, c)
				break
			}
		}
	}
	if len(members) == 0 {
		return satisfied(cFalse, ReasonAllManagedClusterSetsEmpty, fmt.Sprintf(MessageAllManagedClusterSetsEmptyFm, bracketList(usable)))
	}
	var names []string
	for _, c := range members {
		if c.GetDeletionTimestamp() != nil { // a terminating cluster is never selected
			continue
		}
		if !matchesPredicate(p, c) || !tolerated(p, c, now, toScenario) {
			continue
		}
		names = append(names, c.GetName())
	}
	sort.Strings(names) // sortBy: ClusterName
	unscheduled := 0
	if p.NumberOfClusters != nil {
		want := int(p.GetNumberOfClusters())
		if len(names) > want {
			names = names[:want]
		}
		unscheduled = want - len(names)
	}
	for _, n := range names {
		st.Decisions = append(st.Decisions, &aigridv1.ClusterDecision{ClusterName: n})
	}
	st.NumberOfSelectedClusters = int32(len(names))
	switch {
	case len(names) == 0:
		return satisfied(cFalse, ReasonNoManagedClusterMatched, MessageNoManagedClusterMatched)
	case unscheduled > 0:
		return satisfied(cFalse, ReasonNotAllDecisionsScheduled, fmt.Sprintf(MessageNotAllDecisionsScheduledFm, unscheduled))
	}
	return satisfied(cTrue, ReasonAllDecisionsScheduled, MessageAllDecisionsScheduled)
}

// validatePlacement checks what the API server would reject on a Placement:
// selector operators and toleration operators outside their enums, values
// with Exists/DoesNotExist, a negative numberOfClusters. The messages are the
// console's wording for the CRD's enum validation.
func validatePlacement(p *aigridv1.Placement) error {
	for _, req := range p.GetLabelSelector().GetMatchExpressions() {
		if err := validateRequirement("spec.placement.label_selector.match_expressions", req.GetKey(), req.GetOperator(), req.GetValues()); err != nil {
			return err
		}
	}
	for _, req := range p.GetClaimExpressions() {
		if err := validateRequirement("spec.placement.claim_expressions", req.GetKey(), req.GetOperator(), req.GetValues()); err != nil {
			return err
		}
	}
	for _, tol := range p.GetTolerations() {
		if op := tol.GetOperator(); op != "" && op != TolerationEqual && op != TolerationExists {
			return fmt.Errorf("spec.placement.tolerations: operator %q is not %s or %s", op, TolerationEqual, TolerationExists)
		}
		if tol.GetEffect() != "" && tol.GetEffect() != TaintNoSelect && tol.GetEffect() != "PreferNoSelect" && tol.GetEffect() != "NoSelectIfNew" {
			return fmt.Errorf("spec.placement.tolerations: effect %q is not NoSelect, PreferNoSelect or NoSelectIfNew", tol.GetEffect())
		}
	}
	if p.NumberOfClusters != nil && p.GetNumberOfClusters() < 0 {
		return fmt.Errorf("spec.placement.number_of_clusters must not be negative, got %d", p.GetNumberOfClusters())
	}
	for _, set := range p.GetClusterSets() {
		if !knownClusterSets[set] {
			return fmt.Errorf("spec.placement.cluster_sets: ManagedClusterSet %q does not exist on the hub", set)
		}
	}
	return nil
}

func validateRequirement(path, key, operator string, values []string) error {
	if key == "" {
		return fmt.Errorf("%s: key is required", path)
	}
	if !knownOperators[operator] {
		return fmt.Errorf("%s: operator %q is not In, NotIn, Exists or DoesNotExist", path, operator)
	}
	switch operator {
	case OperatorIn, OperatorNotIn:
		if len(values) == 0 {
			return fmt.Errorf("%s: operator %s needs at least one value", path, operator)
		}
	default:
		if len(values) != 0 {
			return fmt.Errorf("%s: operator %s takes no values", path, operator)
		}
	}
	return nil
}
