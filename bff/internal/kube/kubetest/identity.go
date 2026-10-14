package kubetest

import (
	authnv1 "k8s.io/api/authentication/v1"
	authzv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// ReactForIdentity makes the fake clientset answer SelfSubjectReview and
// SelfSubjectAccessReview the way the API server would for the given caller.
// Access reviews are allowed only when admin is true and the review asks for
// patch on managedclusters.
func ReactForIdentity(cs *kubefake.Clientset, username string, groups []string, admin bool) {
	cs.PrependReactor("create", "selfsubjectreviews", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, &authnv1.SelfSubjectReview{Status: authnv1.SelfSubjectReviewStatus{UserInfo: authnv1.UserInfo{Username: username, Groups: groups}}}, nil
	})
	cs.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		sar := action.(k8stesting.CreateAction).GetObject().(*authzv1.SelfSubjectAccessReview)
		attrs := sar.Spec.ResourceAttributes
		allowed := admin && attrs != nil && attrs.Resource == "managedclusters" && attrs.Verb == "patch"
		return true, &authzv1.SelfSubjectAccessReview{Status: authzv1.SubjectAccessReviewStatus{Allowed: allowed}}, nil
	})
}
