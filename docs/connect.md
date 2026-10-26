# The backend's API in the console: types, calls and changes

The console is moving from its own draft proto and hand-written JSON to the backend's own API,
`ai_grid.v1` in ai-grid-cloud/ai-grid-provider-backend, called from the browser over Connect
with clients generated from that proto (ADRs 0001, 0002 and 0004). This page is the working guide:
how a call travels, where the types come from, how a page uses them, how to test, and what to do
when the API has to change. The backend's side of the same rules is its
`docs/API_CONTRACT.md`.

The foundation is in place and no page uses it yet. Areas move one at a time (Clusters, then
Organizations, then Models and Subscriptions); each move deletes that area's draft RPCs, fake data,
BFF handlers and hand-written frontend types. When the last one moves, `mock/proto`, `bff/gen`, the
console's fake backend and `frontend/src/api`'s hand-written layer go.

## How a call travels

```text
page ── generated client ──► kube-auth-proxy ──► BFF relay ──► backend :9090 ──► hub
        POST /ai_grid.v1.Clusters/List      (login,      (identity,    (connect-go:
        Content-Type: application/json       401 on       gates; never  validation,
                                             --api-route) reads bodies) handlers)
```

- **The page** calls a method on a client generated from the backend's proto
  (`frontend/src/api/connect/clients.ts`). The request and the answer are typed from the same
  `.proto` files the backend's Go code is generated from.
- **kube-auth-proxy** signs the user in. For paths matching `--api-route=^/ai_grid\.v1\.` it
  answers an expired session with 401 instead of a login redirect, which a Connect client can't
  follow.
- **The BFF relay** (`bff/internal/relay`) checks the caller as `/api/v1` does (signed in, provider
  admin), drops every identity header the browser sent, sets the caller's token and identity the
  way the gRPC client does, and forwards the bytes unchanged. It accepts only the Connect protocol,
  bounds the wait, and passes back only the response headers a Connect client needs. It never
  decodes a body and has no per-RPC code: a new RPC needs no BFF change. Rules and errors:
  `docs/plan/bff-api.md`, "The Connect relay".
- **The backend** decodes the request into the same generated message, runs its checks and
  answers. Its REST surface (vanguard, `/api/v1/...` on the backend's own port) is for other tools;
  the console never uses it.

## Where the types come from

- `.backend-api-version` holds one full commit SHA of the backend. The console is built against
  that commit's `proto/` (package `ai_grid.v1`; `ai_grid/draft` is excluded).
- `make generate-api` writes `frontend/src/gen` with protoc-gen-es v2 (a pinned devDependency,
  run locally by buf through `go run`), plus `google/rpc/error_details.proto` for field errors.
- `frontend/src/gen` is committed and never edited by hand. `make check-generated-api` regenerates
  into a temporary directory and fails CI when anything differs: stale, hand-edited, missing or
  left-over files.
- Never write a TypeScript type that repeats a message the generated code already has. A page may
  have small display helpers (formatting a quantity, a label for an enum value); anything that
  decides what data means belongs in the backend (ADR-0002, and AGENTS.md "The BFF does transport
  only").

## Using it in a page

```ts
import { Code, ConnectError } from '@connectrpc/connect';
import { createConsoleClients } from '../api/connect/clients';
import { createConsoleTransport } from '../api/connect/transport';
import { describeError } from '../api/connect/errors';

const { clusters } = createConsoleClients(createConsoleTransport({ checkSession }));

const { items, total } = await clusters.list({ limit: 50 });

await clusters.update({
  object: { id: c.id, metadata: { labels: next, version: c.metadata?.version } },
  updateMask: { paths: ['metadata.labels'] },
  lock: true, // the backend answers Aborted if someone changed it since c was read
});
```

- **Errors.** `describeError` and `toServiceError` (`errors.ts`) turn a `ConnectError` into the
  states the pages already show: NotFound, Aborted (a conflict: reload and say so),
  PermissionDenied, Unauthenticated (the session-ended flow; the transport also calls
  `checkSession`), Unimplemented (not available on this backend), and InvalidArgument with the
  field errors from `google.rpc.BadRequest`. Only request-related codes show the backend's own
  message; server-side failures show the console's generic text, as the BFF's `/api/v1` errors do.
- **Optimistic locking.** Send the version the page read, with `lock: true` where the request has
  it; a stale version answers Aborted. `Metadata.version` is `int32` at today's pin and becomes a
  string (ADR-0003), which the generated types will show when the pin moves.
- **Field masks.** An Update changes only the paths in `updateMask`; a map field (labels) is
  replaced whole, so send the whole map the page edited.
- **Enums.** A value the console's pin doesn't know arrives as the field's zero value
  (`..._UNSPECIFIED`). Give every `switch` over an enum a default branch that reads as "unknown";
  an exhaustive `switch` also makes `tsc` point at the code to update when a new value appears.
- **Unknown fields** in an answer from a newer backend are ignored, so the console keeps working
  until the pin moves.

## Testing

`fakeClients` (`testing.ts`) gives typed clients over an in-memory backend
(`createRouterTransport`):

```ts
const { clients } = fakeClients({
  clusters: {
    list: () => ({ items: [siteA], size: 1, total: 1 }), // checked against ClustersListResponse
    update: () => { throw new ConnectError('stale', Code.Aborted); },
  },
});
```

- A method left out answers Unimplemented, like an RPC the backend doesn't have.
- The fake's answers are type-checked against the generated messages and go through the same
  serialization as the wire, so a fake can't drift from the API the way the hand-written
  `MockConsoleService` could.
- For the whole stack, `make dev-fake-infra` runs the backend at the pinned commit on its own fake
  hub and fake Keycloak (its `make dev-fake`, checked out into `.cache/backend/<sha>`, or
  `BACKEND_DIR`), with the BFF and the frontend in front of it. `make dev-fake` (the console's own
  fake, which serves the draft) stays until the last area moves.

## When the page needs something the API doesn't have

1. **Change the backend first.** Add the field or RPC to `proto/ai_grid/v1` in the backend, with
   its implementation, in a backend PR that follows the backend's `docs/API_CONTRACT.md`. Don't add
   it to `mock/proto`, and don't compute it in the page or the BFF.
2. **Move the pin** to a backend commit that has it (the PR's head while it's open, `main` once it
   merges): change `.backend-api-version`, run `make generate-api`, and commit both with the page
   change.
3. **Build the page** against the generated type; test it with `fakeClients` and try it with
   `make dev-fake-infra`.

## When the pin moves and something breaks

- **`tsc` fails:** the backend changed something a page uses. Fix the page in the same change as
  the pin bump; the pin doesn't move until it compiles and the tests pass.
- **A field is marked `@deprecated`:** the backend is retiring it (expand, migrate, contract). Move
  the page to the replacement now; the backend removes the field only after the console's pin no
  longer uses it.
- **The meaning changed but the type didn't:** no compiler can see this. The backend's contract
  rules say a changed meaning is a new field; if one slips through, raise it on the backend PR.

## Not built yet

- No page uses the clients; `createConsoleTransport` is wired into the app with the first area
  that moves.
- A nightly job that proposes moving the pin to the backend's newest `main` and runs typecheck and
  tests (the pattern OSAC uses for its UI).
- Connect GET: no backend method is marked free of side effects yet, so every call is a POST.
