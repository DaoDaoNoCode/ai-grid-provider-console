# mock/

What is left of the console's former fake backend: data files that tests read, none of them a
fake. To run the console without a cluster, `make dev-fake` runs the real backend on its own fake
hub and Keycloak (`docs/dev-setup.md`).

| Path | What | Kept current by |
|---|---|---|
| `examples/` | The BFF's own JSON for `/api/v1/user`, `/api/v1/config` and its errors, one request and answer per file (`{"request", "requestBody"?, "token", "user", "status", "responseHeaders"?, "body"}`). The frontend's tests and `hack/check-chart.sh` read them as what the BFF sends. | `bff/internal/examples/golden_test.go`: `go test` fails when a file differs, `make -C bff golden` rewrites them |
| `validation/cases.json` | The form validation cases, with the messages each rule gives | `frontend/src/validation/cases.test.ts` |

The fixtures are fictional: `example.com` hosts, invented names and tokens only. This
repository is public.
