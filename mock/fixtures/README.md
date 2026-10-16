# Fixtures

The data the fake backend (`bff/cmd/fake-backend`) loads at start, from this directory by
default (`--fixtures`). Every name, id, host and number is fictional. What the fake does with
each area's data is in `mock/areas/`.

| File | Shape | Notes |
|---|---|---|
| `managedclusters.json` | `{"clusters": [ai_grid.v1.ManagedCluster...]}` in protojson | Full hub objects: labels exactly as ACM writes them (`name`, `cloud`, `vendor`, `clusterID`, `openshiftVersion*`, `clusterset=default`, `feature.open-cluster-management.io/addon-*`) plus the console's `ai-grid/*` labels and annotations, `uid`, `resourceVersion`, `creationTimestamp`, finalizers, taints, client configs, and a `status` with every condition's exact type, reason and message, name-sorted claims, capacity (`nvidia.com/gpu` on GPU clusters) and version. One cluster per state the ACM console distinguishes: `local-cluster`, `site-paris-1`, `site-frankfurt-1` ready (Paris enrolled with GPUs, Frankfurt not enrolled); `site-madrid-1` unknown (lease expired, taint `unreachable`, add-ons `unreachable`); `site-ashburn-1` offline (API server down, taint `unavailable`); `site-berlin-1` importing and `site-oslo-1` pending import (`auto-detect` labels, no claims); `site-dublin-1` import failed; `site-lisbon-1` not accepted (`hubAcceptsClient: false`, `HubClusterAdminDenied`); `edge-lyon-2` detaching (`deletionTimestamp`, `Deleting/ResourceRemaining`; the research verified that reason but not its message, which is left empty). `status.state` and `status.stateMessage` are derived by the server on every read and must not be written here. |
| `tenants.json` | `{"tenants": [ai_grid.v1.Tenant...]}` | Keycloak Organizations as the backend maps them. Replace with `{"unavailable": "..."}` to reproduce the dev hub, where the `ai-grid` realm does not exist. |
| `scenarios.json` | `{"events": [{"cluster", "at", "event", ...}]}` | Timed cluster transitions relative to the fake's start, in scenario time (`at`, a Go duration, divided by `speed` in `settings.json` for wall-clock time). The events and what each one changes are in `bff/internal/fakebackend/scenarios.go`; `mock/areas/clusters.md` lists the shipped ones. |
| `access.json` | who is a provider admin | Drives the fake hub's access review **and** the fake backend's answer to a mutating RPC: a token in `deniedTokens` (or any token when `defaultAllowed` is false) gets `PermissionDenied` with the API server's forbidden message from `UpdateManagedCluster`, a token in `rejectedTokens` gets `Unauthenticated` from every RPC, reads included, like an expired OpenShift token at the hub; so `AUTH_TOKEN=viewer-token` sees the clusters but cannot enrol one (the BFF answers 403) and `AUTH_TOKEN=expired-token` sees nothing but the signed-out path. |
| `settings.json` | latency, speed | `latency` is a Go duration such as `"40ms"` added to every RPC; a hub list from a pod on the hub takes tens of milliseconds. `speed` multiplies the scenario clock (`10` plays the five-minute scenario in 30 seconds; default `1`). |

Fixtures are protojson so they use the field names grpcurl shows and fail to load on any
unknown field; a fixture that fails to load stops the fake with an error, so a typo never
serves nonsense. A missing file leaves its part empty, except `access.json`: without it every
token is a provider admin. The directory itself must exist. Tests load the shipped directory
and check the ACM labels, that every condition uses only a type, reason and message the
research verified, that claims are sorted, that hub taints match the Available condition, and
that each cluster derives the state it was seeded for. Fixture names, labels and ids must never
be real: this repository is public.
