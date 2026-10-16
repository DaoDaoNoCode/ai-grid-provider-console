package api

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	aigridv1 "github.com/ai-grid-cloud/ai-grid-provider-console/bff/gen/ai_grid/v1"
	"github.com/ai-grid-cloud/ai-grid-provider-console/bff/internal/backend/backendtest"
)

func seedTenants() []*aigridv1.Tenant {
	return []*aigridv1.Tenant{
		{Id: "t-2", Name: "globex-research", Alias: "globex", Enabled: proto.Bool(true), Domains: []string{"globex.example.com"},
			DomainDetails: []*aigridv1.TenantDomain{{Name: "globex.example.com", Verified: true}}},
		{Id: "t-1", Name: "acme-robotics", Alias: "acme-robotics", Enabled: proto.Bool(true), Description: "Acme", Attributes: map[string]string{"billing-account": "ACME-0042"},
			Domains:       []string{"acme.example.com", "*.acme.example.org"},
			DomainDetails: []*aigridv1.TenantDomain{{Name: "acme.example.com", Verified: true, IdentityProviderAlias: "acme-oidc", AutoRedirect: true}, {Name: "*.acme.example.org"}}},
		{Id: "t-3", Name: "umbrella-biotech", Alias: "umbrella-biotech", Enabled: proto.Bool(false)},
	}
}

func jsonRequest(method, path, body string) *http.Request {
	req := asUser(method, path)
	req.Body = io.NopCloser(strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeList(t *testing.T, rec *httptest.ResponseRecorder, into any) ListMeta {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
		Meta ListMeta        `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope %q: %v", rec.Body.String(), err)
	}
	if err := json.Unmarshal(env.Data, into); err != nil {
		t.Fatalf("decode data %q: %v", env.Data, err)
	}
	return env.Meta
}

// total is meta.Total, -1 when it is omitted.
func total(meta ListMeta) int {
	if meta.Total == nil {
		return -1
	}
	return *meta.Total
}

func TestListTenantsPagesAndSearches(t *testing.T) {
	fake := &backendtest.Fake{Tenants: seedTenants()}
	app := newTestApp(t, testConfig(t), fake)

	var list []Tenant
	rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	meta := decodeList(t, rec, &list)
	if len(list) != 3 || list[0].Name != "acme-robotics" || list[2].Name != "umbrella-biotech" {
		t.Fatalf("list = %+v", list)
	}
	if meta.Size != 3 || total(meta) != 3 || meta.Offset != 0 || meta.Limit != nil {
		t.Errorf("meta = %+v", meta)
	}
	if !strings.Contains(rec.Body.String(), `"meta":{"size":3,"total":3,"offset":0}`) {
		t.Errorf("limit is omitted when the caller asked for everything: %s", rec.Body.String())
	}
	acme := list[0]
	if acme.Alias != "acme-robotics" || !acme.Enabled || acme.Description != "Acme" || acme.Attributes["billing-account"] != "ACME-0042" || len(acme.Domains) != 2 {
		t.Errorf("acme = %+v", acme)
	}
	if len(acme.DomainDetails) != 2 || !acme.DomainDetails[0].Verified || acme.DomainDetails[0].IdentityProviderAlias != "acme-oidc" || !acme.DomainDetails[0].AutoRedirect || acme.DomainDetails[1].Name != "*.acme.example.org" {
		t.Errorf("domainDetails = %+v", acme.DomainDetails)
	}
	if u := list[2]; u.Enabled || u.Domains == nil || u.DomainDetails == nil || u.Attributes == nil {
		t.Errorf("collections are always present, enabled false kept: %s", rec.Body.String())
	}
	if fake.LastListTenants.Offset != nil || fake.LastListTenants.Limit != nil || fake.LastListTenants.Filter != nil {
		t.Errorf("no query means an empty request: %v", fake.LastListTenants)
	}

	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?offset=1&limit=1&search=%22Bio%22"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	meta = decodeList(t, rec, &list)
	if fake.LastListTenants.GetOffset() != 1 || fake.LastListTenants.GetLimit() != 1 || fake.LastListTenants.GetFilter() != `this.name.contains("\"Bio\"") || this.domains.exists(d, d.contains("\"Bio\""))` {
		t.Errorf("query not mapped to the request, got %v", fake.LastListTenants)
	}
	if meta.Offset != 1 || meta.Limit == nil || *meta.Limit != 1 {
		t.Errorf("meta echoes the page: %+v", meta)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?search=bio"))
	meta = decodeList(t, rec, &list)
	if len(list) != 1 || list[0].Name != "umbrella-biotech" || total(meta) != 1 {
		t.Errorf("search = %+v %+v", list, meta)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?search=example.org"))
	decodeList(t, rec, &list)
	if len(list) != 1 || list[0].Name != "acme-robotics" {
		t.Errorf("search matches domains too: %+v", list)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?search=%20%20"))
	meta = decodeList(t, rec, &list)
	if fake.LastListTenants.Filter != nil || total(meta) != 3 {
		t.Errorf("a blank search sends no filter: %v", fake.LastListTenants)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?limit=0"))
	meta = decodeList(t, rec, &list)
	if len(list) != 0 || meta.Size != 0 || total(meta) != 3 || meta.Limit == nil || *meta.Limit != 0 {
		t.Errorf("limit=0 counts only: %+v %+v", list, meta)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?offset=10&limit=5"))
	meta = decodeList(t, rec, &list)
	if len(list) != 0 || total(meta) != 3 || meta.Offset != 10 {
		t.Errorf("offset past the end is an empty page with the total: %+v %+v", list, meta)
	}
	for _, q := range []string{"offset=-1", "limit=x", "limit=-2", "limit=2147483648", "offset=4294967296", "limit=99999999999999999999"} {
		if rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants?"+q)); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s -> %d, want 422 (the request fields are int32)", q, rec.Code)
		}
	}
	// The largest int32 is accepted and reaches the backend unchanged.
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants?offset=2147483647&limit=2147483647"))
	meta = decodeList(t, rec, &list)
	if rec.Code != http.StatusOK || fake.LastListTenants.GetOffset() != math.MaxInt32 || fake.LastListTenants.GetLimit() != math.MaxInt32 || meta.Offset != math.MaxInt32 || len(list) != 0 {
		t.Errorf("max int32 = %d %+v, request %v", rec.Code, meta, fake.LastListTenants)
	}
}

func TestTenantFromTodaysBackend(t *testing.T) {
	// Fields 1-3 only: alias falls back to the name, details are derived and an
	// absent `enabled` reads as enabled (Keycloak's default), never as disabled.
	tn := toTenant(&aigridv1.Tenant{Id: "x", Name: "tenant-a", Domains: []string{"a.example.com"}})
	if tn.Alias != "tenant-a" || len(tn.DomainDetails) != 1 || tn.DomainDetails[0].Name != "a.example.com" || tn.Attributes == nil || !tn.Enabled {
		t.Errorf("tenant = %+v", tn)
	}
	if toTenant(&aigridv1.Tenant{Id: "x", Name: "off", Enabled: proto.Bool(false)}).Enabled {
		t.Error("an explicit false is kept")
	}
	fake := &backendtest.Fake{Tenants: []*aigridv1.Tenant{{Id: "t-1", Name: "tenant-a"}}}
	rec := serve(newTestApp(t, testConfig(t), fake), asUser(http.MethodGet, "/api/v1/tenants"))
	if !strings.Contains(rec.Body.String(), `"enabled":true`) {
		t.Errorf("today's backend must not render every tenant disabled: %s", rec.Body.String())
	}
	bare := toTenant(&aigridv1.Tenant{Id: "y", Name: "bare"})
	if bare.Domains == nil || bare.DomainDetails == nil || len(bare.Domains) != 0 {
		t.Errorf("bare = %+v", bare)
	}
}

func TestGetTenant(t *testing.T) {
	app := newTestApp(t, testConfig(t), &backendtest.Fake{Tenants: seedTenants()})
	var tn Tenant
	rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-2"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	decodeData(t, rec, &tn)
	if tn.Name != "globex-research" || tn.Alias != "globex" {
		t.Errorf("tenant = %+v", tn)
	}
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants/missing"))
	if rec.Code != http.StatusNotFound || decodeError(t, rec).Error.Message != "object with identifier 'missing' not found" {
		t.Errorf("missing = %d %s", rec.Code, rec.Body.String())
	}
}

func TestCreateTenant(t *testing.T) {
	t.Run("201 with Location", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "wayne-aerospace", "description": "Wayne", "domains": ["wayne-aero.example.com"], "attributes": {"ai-grid/region": "us-east"}}`))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
		}
		var tn Tenant
		decodeData(t, rec, &tn)
		if tn.ID != "t-4" || tn.Name != "wayne-aerospace" || tn.Alias != "wayne-aerospace" || !tn.Enabled || tn.Description != "Wayne" || tn.Domains[0] != "wayne-aero.example.com" || tn.DomainDetails[0].Name != "wayne-aero.example.com" || tn.Attributes["ai-grid/region"] != "us-east" {
			t.Errorf("created = %+v", tn)
		}
		if loc := rec.Header().Get("Location"); loc != "/api/v1/tenants/t-4" {
			t.Errorf("Location = %q", loc)
		}
		sent := fake.LastCreateTenant.GetObject()
		if sent.Enabled != nil || sent.GetId() != "" || sent.GetAlias() != "" {
			t.Errorf("an absent enabled stays absent (the backend applies Keycloak's default), id and alias are left to the backend: %v", sent)
		}
		if got := fake.Metadata.Get("authorization"); len(got) != 1 || got[0] != "Bearer sha256~token" {
			t.Errorf("token not forwarded: %v", fake.Metadata)
		}
		rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "stark", "alias": "stark-industries", "enabled": false}`))
		if rec.Code != http.StatusCreated || fake.LastCreateTenant.GetObject().Enabled == nil || fake.LastCreateTenant.GetObject().GetEnabled() || fake.LastCreateTenant.GetObject().GetAlias() != "stark-industries" {
			t.Errorf("explicit enabled=false and alias are sent as given: %d %v", rec.Code, fake.LastCreateTenant)
		}
		if loc := rec.Header().Get("Location"); loc != "/api/v1/tenants/t-5" {
			t.Errorf("Location = %q", loc)
		}
	})

	t.Run("keycloak and body errors", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "acme-robotics"}`))
		if rec.Code != http.StatusConflict || decodeError(t, rec).Error.Message != "A organization with the same name already exists." {
			t.Errorf("duplicate = %d %s", rec.Code, rec.Body.String())
		}
		rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": ""}`))
		if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != "Name can not be null" {
			t.Errorf("blank name = %d %s", rec.Code, rec.Body.String())
		}
		for body, want := range map[string]string{
			`{"name": 1}`:                `invalid request body: field "name" must be a string`,
			`{"name": "x", "colour": 1}`: `invalid request body: json: unknown field "colour"`,
			`{`:                          "invalid request body: malformed JSON",
			``:                           "invalid request body: empty body",
			`null`:                       "invalid request body: must be a JSON object",
			`["acme"]`:                   "invalid request body: must be a JSON object",
		} {
			rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", body))
			if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != want {
				t.Errorf("%s -> %d %s, want 422 %q", body, rec.Code, rec.Body.String(), want)
			}
		}
		if rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "`+strings.Repeat("x", maxBodyBytes)+`"}`)); rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("oversized body = %d %s", rec.Code, rec.Body.String())
		}
		fake.LastCreateTenant = nil
		fake.Err = backendtest.Status(codes.InvalidArgument, "Domain acme.example.com is already linked to organization acme-robotics in realm ai-grid")
		rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "x", "domains": ["acme.example.com"]}`))
		if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(decodeError(t, rec).Error.Message, "already linked to organization acme-robotics") {
			t.Errorf("InvalidArgument -> %d %s, want 422 with Keycloak's message", rec.Code, rec.Body.String())
		}
		fake.Err = backendtest.Status(codes.PermissionDenied, `User "alice" is not a provider admin: cannot patch resource "managedclusters" in API group "cluster.open-cluster-management.io" at the cluster scope`)
		if rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "x"}`)); rec.Code != http.StatusForbidden || !strings.Contains(decodeError(t, rec).Error.Message, "not a provider admin") {
			t.Errorf("PermissionDenied -> %d %s", rec.Code, rec.Body.String())
		}
		fake.Err = backendtest.Status(codes.FailedPrecondition, `Keycloak realm "ai-grid": Realm not found.`)
		if rec := serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "x"}`)); rec.Code != http.StatusPreconditionFailed {
			t.Errorf("FailedPrecondition -> %d", rec.Code)
		}
		fake.Err = backendtest.Status(codes.Unavailable, "Keycloak is unavailable: connection refused")
		if rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants")); rec.Code != http.StatusServiceUnavailable {
			t.Errorf("Unavailable -> %d", rec.Code)
		}
	})
}

func TestPatchTenant(t *testing.T) {
	t.Run("present fields become the mask", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"enabled": false, "description": "", "domains": ["acme.example.com"]}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
		}
		var tn Tenant
		decodeData(t, rec, &tn)
		if tn.Enabled || tn.Description != "" || len(tn.Domains) != 1 || tn.Name != "acme-robotics" || tn.Attributes["billing-account"] != "ACME-0042" {
			t.Errorf("patched = %+v", tn)
		}
		up := fake.LastUpdateTenant
		if paths := up.GetUpdateMask().GetPaths(); strings.Join(paths, ",") != "description,enabled,domains" {
			t.Errorf("mask = %v", paths)
		}
		if up.GetObject().GetId() != "t-1" || up.GetObject().GetName() != "" || up.GetObject().GetAlias() != "" {
			t.Errorf("only the patched fields travel: %v", up.GetObject())
		}
		rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"attributes": {}, "domains": [], "name": "acme-eu", "alias": "acme-robotics"}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
		}
		up = fake.LastUpdateTenant
		if paths := up.GetUpdateMask().GetPaths(); strings.Join(paths, ",") != "name,domains,attributes" {
			t.Errorf("mask = %v", paths)
		}
		if up.GetObject().GetAlias() != "acme-robotics" || len(up.GetObject().GetAttributes()) != 0 || len(up.GetObject().GetDomains()) != 0 {
			// An empty map or list is absent on the wire; the mask path is what tells the backend to clear it.
			t.Errorf("alias travels in the object, cleared collections are empty: %v", up.GetObject())
		}
		var cleared Tenant
		decodeData(t, rec, &cleared)
		if len(cleared.Domains) != 0 || len(cleared.Attributes) != 0 || cleared.Name != "acme-eu" {
			t.Errorf("cleared = %+v", cleared)
		}
	})

	t.Run("null leaves a field alone and is not in the mask", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"domains": null, "attributes": null, "description": null, "enabled": false}`))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
		}
		if paths := fake.LastUpdateTenant.GetUpdateMask().GetPaths(); strings.Join(paths, ",") != "enabled" {
			t.Errorf("null must not put a path in the mask, got %v", paths)
		}
		var tn Tenant
		decodeData(t, rec, &tn)
		if len(tn.Domains) != 2 || tn.Attributes["billing-account"] != "ACME-0042" || tn.Description != "Acme" || tn.Enabled {
			t.Errorf("patched = %+v", tn)
		}
	})

	t.Run("empty and alias-only patches read without writing", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-2", `{}`))
		if rec.Code != http.StatusOK || fake.LastUpdateTenant != nil {
			t.Errorf("empty patch = %d, update %v", rec.Code, fake.LastUpdateTenant)
		}
		rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-2", `{"alias": "globex"}`))
		if rec.Code != http.StatusOK || fake.LastUpdateTenant != nil {
			t.Errorf("same alias = %d %s, update %v", rec.Code, rec.Body.String(), fake.LastUpdateTenant)
		}
		rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-2", `{"alias": "globex-2"}`))
		if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != "Cannot change the alias" || fake.LastUpdateTenant != nil {
			t.Errorf("alias change = %d %s, update %v", rec.Code, rec.Body.String(), fake.LastUpdateTenant)
		}
		// With another field present the alias travels to the backend, which answers like Keycloak.
		rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-2", `{"alias": "globex-2", "enabled": false}`))
		if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != "Cannot change the alias" || fake.LastUpdateTenant == nil {
			t.Errorf("alias change with a write = %d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("errors", func(t *testing.T) {
		fake := &backendtest.Fake{Tenants: seedTenants()}
		app := newTestApp(t, testConfig(t), fake)
		if rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/missing", `{"enabled": true}`)); rec.Code != http.StatusNotFound {
			t.Errorf("missing = %d", rec.Code)
		}
		for body, want := range map[string]string{
			`{"enabled": "yes"}`: `invalid request body: field "enabled" must be a bool`,
			`{"version": 3}`:     `invalid request body: json: unknown field "version"`,
			`{"domains": "a"}`:   `invalid request body: field "domains" must be a []string`,
			`{"enabled": true}}`: "invalid request body: unexpected content after the JSON object",
			`null`:               "invalid request body: must be a JSON object",
		} {
			rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", body))
			if rec.Code != http.StatusUnprocessableEntity || decodeError(t, rec).Error.Message != want {
				t.Errorf("%s -> %d %s, want 422 %q", body, rec.Code, rec.Body.String(), want)
			}
		}
		// A blank name is Keycloak's 409, not a 422 (see UpdateTenant in the fake backend).
		if rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"name": ""}`)); rec.Code != http.StatusConflict || decodeError(t, rec).Error.Message != "A organization with the same name already exists." {
			t.Errorf("blank name = %d %s, want 409 with Keycloak's message", rec.Code, rec.Body.String())
		}
		fake.Err = backendtest.Status(codes.AlreadyExists, "A organization with the same name already exists.")
		if rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"name": "globex-research"}`)); rec.Code != http.StatusConflict {
			t.Errorf("rename conflict = %d", rec.Code)
		}
	})
}

func TestDeleteTenant(t *testing.T) {
	fake := &backendtest.Fake{Tenants: seedTenants()}
	app := newTestApp(t, testConfig(t), fake)
	rec := serve(app, asUser(http.MethodDelete, "/api/v1/tenants/t-3"))
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("delete = %d %q", rec.Code, rec.Body.String())
	}
	if fake.LastDeleteTenant.GetId() != "t-3" || len(fake.Tenants) != 2 {
		t.Errorf("delete request = %v, tenants left %d", fake.LastDeleteTenant, len(fake.Tenants))
	}
	rec = serve(app, asUser(http.MethodDelete, "/api/v1/tenants/t-3"))
	if rec.Code != http.StatusNotFound || decodeError(t, rec).Error.Message != "object with identifier 't-3' not found" {
		t.Errorf("second delete = %d %s", rec.Code, rec.Body.String())
	}
	// A tenant created after a delete gets a fresh id, never a recycled one.
	var created Tenant
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "after-delete"}`))
	decodeData(t, rec, &created)
	if rec.Code != http.StatusCreated || created.ID != "t-4" {
		t.Errorf("created after delete = %d %+v, want id t-4", rec.Code, created)
	}
	if rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-3")); rec.Code != http.StatusNotFound {
		t.Errorf("the deleted id must stay gone: %d", rec.Code)
	}
	if rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-3")); rec.Code != http.StatusNotFound {
		t.Errorf("get after delete = %d", rec.Code)
	}
	fake.Err = backendtest.Status(codes.PermissionDenied, "User \"alice\" is not a provider admin")
	if rec := serve(app, asUser(http.MethodDelete, "/api/v1/tenants/t-1")); rec.Code != http.StatusForbidden {
		t.Errorf("denied delete = %d", rec.Code)
	}
	if rec := serve(app, httptest.NewRequest(http.MethodDelete, "/api/v1/tenants/t-1", nil)); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous delete = %d", rec.Code)
	}
}

func TestTenantVersions(t *testing.T) {
	tenants := seedTenants()
	tenants[1].ResourceVersion = "4" // acme-robotics, t-1
	fake := &backendtest.Fake{Tenants: tenants}
	app := newTestApp(t, testConfig(t), fake)
	withIfMatch := func(req *http.Request, v string) *http.Request { req.Header.Set("If-Match", v); return req }

	rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-1"))
	var got Tenant
	decodeData(t, rec, &got)
	if rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"4"` || got.ResourceVersion != "4" {
		t.Fatalf("GET = %d, ETag %q, resourceVersion %q", rec.Code, rec.Header().Get("ETag"), got.ResourceVersion)
	}

	// A stale tab: 409, nothing written.
	rec = serve(app, withIfMatch(jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"description": "stale"}`), `"3"`))
	if rec.Code != http.StatusConflict || fake.LastUpdateTenant.GetObject().GetResourceVersion() != "3" {
		t.Fatalf("stale PATCH = %d %s, request %v", rec.Code, rec.Body.String(), fake.LastUpdateTenant)
	}
	if fake.Tenants[1].GetDescription() != "Acme" || fake.Tenants[1].GetResourceVersion() != "4" {
		t.Errorf("a stale write must not land: %v", fake.Tenants[1])
	}
	// The current version writes and answers the next one.
	rec = serve(app, withIfMatch(jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"description": "fresh"}`), `"4"`))
	decodeData(t, rec, &got)
	if rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"5"` || got.Description != "fresh" || got.ResourceVersion != "5" {
		t.Fatalf("matching PATCH = %d, ETag %q, %+v", rec.Code, rec.Header().Get("ETag"), got)
	}
	// Without If-Match the update carries no version: not checked, as before.
	rec = serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"description": "unchecked"}`))
	if rec.Code != http.StatusOK || fake.LastUpdateTenant.GetObject().GetResourceVersion() != "" || rec.Header().Get("ETag") != `"6"` {
		t.Errorf("PATCH without If-Match = %d, request %v", rec.Code, fake.LastUpdateTenant)
	}
	// A PATCH that sets no field writes nothing, so it does not check a version.
	if rec := serve(app, withIfMatch(jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{}`), `"1"`)); rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"6"` {
		t.Errorf("empty PATCH with a stale If-Match = %d, ETag %q", rec.Code, rec.Header().Get("ETag"))
	}
	if rec := serve(app, withIfMatch(jsonRequest(http.MethodPatch, "/api/v1/tenants/t-1", `{"enabled": false}`), `6`)); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("an unquoted If-Match = %d, want 422", rec.Code)
	}

	// DELETE: stale is 409 and keeps the tenant, current deletes.
	rec = serve(app, withIfMatch(asUser(http.MethodDelete, "/api/v1/tenants/t-1"), `"5"`))
	if rec.Code != http.StatusConflict || fake.LastDeleteTenant.GetResourceVersion() != "5" || len(fake.Tenants) != 3 {
		t.Fatalf("stale DELETE = %d %s, request %v", rec.Code, rec.Body.String(), fake.LastDeleteTenant)
	}
	if rec := serve(app, withIfMatch(asUser(http.MethodDelete, "/api/v1/tenants/t-1"), `"6"`)); rec.Code != http.StatusNoContent || len(fake.Tenants) != 2 {
		t.Errorf("matching DELETE = %d", rec.Code)
	}
	// Without If-Match the delete is unconditional.
	if rec := serve(app, asUser(http.MethodDelete, "/api/v1/tenants/t-2")); rec.Code != http.StatusNoContent || fake.LastDeleteTenant.GetResourceVersion() != "" {
		t.Errorf("DELETE without If-Match = %d, request %v", rec.Code, fake.LastDeleteTenant)
	}
	// A created tenant comes back with its first version.
	rec = serve(app, jsonRequest(http.MethodPost, "/api/v1/tenants", `{"name": "new-org"}`))
	if rec.Code != http.StatusCreated || rec.Header().Get("ETag") != `"1"` {
		t.Errorf("POST = %d, ETag %q", rec.Code, rec.Header().Get("ETag"))
	}
	// A backend that keeps no version (today's) sends no ETag and no field.
	fake.Tenants = append(fake.Tenants, &aigridv1.Tenant{Id: "t-9", Name: "unversioned"})
	rec = serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-9"))
	if rec.Header().Get("ETag") != "" || strings.Contains(rec.Body.String(), "resourceVersion") {
		t.Errorf("no version: ETag %q, body %s", rec.Header().Get("ETag"), rec.Body.String())
	}
}

// The shipped backend's ListTenantsRequest is empty: it drops offset, limit
// and filter and returns every tenant with no total. Asking it for a search
// or a page is 501, never the unfiltered rows as if they were the result.
func TestTenantSearchAndPagingOnTheShippedBackend(t *testing.T) {
	var many []*aigridv1.Tenant
	for i := range 8 {
		many = append(many, &aigridv1.Tenant{Id: fmt.Sprintf("t-%d", i+1), Name: fmt.Sprintf("org-%d", i+1)})
	}
	fake := &backendtest.Fake{Tenants: many, ShippedLists: true}
	app := newTestApp(t, testConfig(t), fake)
	for _, q := range []string{"search=zzz&limit=5", "search=org", "limit=5", "offset=3", "offset=1&limit=100"} {
		rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants?"+q))
		if rec.Code != http.StatusNotImplemented {
			t.Errorf("%s on the shipped backend = %d %s, want 501", q, rec.Code, rec.Body.String())
			continue
		}
		if msg := decodeError(t, rec).Error.Message; msg != "the AI Grid backend does not support searching or paging tenants yet; list them without search, filter, offset or limit" {
			t.Errorf("message = %q", msg)
		}
	}
	// No search and no page (offset=0 is the start anyway): the full list,
	// with the size as the total because nothing precedes it.
	for _, q := range []string{"", "?offset=0", "?search=%20"} {
		var list []Tenant
		rec := serve(app, asUser(http.MethodGet, "/api/v1/tenants"+q))
		if rec.Code != http.StatusOK {
			t.Fatalf("%q = %d %s", q, rec.Code, rec.Body.String())
		}
		if meta := decodeList(t, rec, &list); len(list) != 8 || meta.Size != 8 || total(meta) != 8 {
			t.Errorf("%q = %d tenants, meta %+v", q, len(list), meta)
		}
	}
}

// The displayed alias (the name, when the backend sends no alias) can be
// sent back unchanged.
func TestDisplayedAliasRoundTrip(t *testing.T) {
	fake := &backendtest.Fake{Tenants: []*aigridv1.Tenant{{Id: "t-9", Name: "noalias"}}}
	app := newTestApp(t, testConfig(t), fake)
	var shown Tenant
	decodeData(t, serve(app, asUser(http.MethodGet, "/api/v1/tenants/t-9")), &shown)
	if shown.Alias != "noalias" {
		t.Fatalf("shown alias = %q", shown.Alias)
	}
	if rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-9", `{"alias": "noalias"}`)); rec.Code != http.StatusOK || fake.Reached("UpdateTenant") {
		t.Errorf("displayed alias sent back = %d %s, calls %v", rec.Code, rec.Body.String(), fake.Calls)
	}
	if rec := serve(app, jsonRequest(http.MethodPatch, "/api/v1/tenants/t-9", `{"alias": "other"}`)); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a different alias = %d, want 422", rec.Code)
	}
}
