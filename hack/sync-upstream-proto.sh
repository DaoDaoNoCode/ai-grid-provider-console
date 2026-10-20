#!/usr/bin/env bash
# Refresh the vendored copy of the backend's real proto and record where it came from.
#
#   hack/sync-upstream-proto.sh <ref>      a branch, tag or commit of the backend repository
#
# Writes mock/proto/upstream/:
#   ai_grid/v1/*.proto  the backend's proto/ai_grid/v1, unchanged, to read and diff
#   image.binpb         those files compiled with their imports (googleapis, protovalidate,
#                       the OpenAPI options) by `buf build`, so the drift test can compare
#                       descriptors without fetching anything
#   COMMIT              the repository, commit and path they came from
# Then run `make -C bff test`: bff/internal/protodrift fails when the BFF's copy of the
# backend's messages (mock/proto/ai_grid/backend/v1) no longer matches. The nightly
# .github/workflows/drift.yaml runs both against the backend's main.
#
# Everything lands in a temporary directory first; the vendored files are replaced only once
# the fetch and the build succeeded, so an error leaves the previous copy in place.
#
#   BACKEND_REPO  git URL (default: the repo= line of COMMIT)
#   BUF           buf command (default: bff/Makefile's, run through go run)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${ROOT}/mock/proto/upstream"
COMMIT_FILE="${UPSTREAM}/COMMIT"
REF="${1:-}"
if [[ -z "${REF}" ]]; then
  echo "usage: $0 <ref>" >&2
  exit 2
fi
REPO="${BACKEND_REPO:-$(sed -n 's/^repo=//p' "${COMMIT_FILE}")}"
PROTO_PATH="$(sed -n 's/^path=//p' "${COMMIT_FILE}")"   # proto/ai_grid/v1
MODULE_DIR="${PROTO_PATH%/ai_grid/v1}"                    # proto: the buf module root
BUF="${BUF:-$(sed -n 's/^BUF := //p' "${ROOT}/bff/Makefile")}"
TMP="$(mktemp -d)"
# If the swap below is cut short, put the previous copy back before the temporary directory goes.
trap '[[ -e "${UPSTREAM}" ]] || mv "${TMP}/previous" "${UPSTREAM}" 2>/dev/null; rm -rf "${TMP}"' EXIT

git clone -q --filter=blob:none --no-checkout "${REPO}" "${TMP}/repo"
git -C "${TMP}/repo" fetch -q origin "${REF}"
SHA="$(git -C "${TMP}/repo" rev-parse FETCH_HEAD)"
git -C "${TMP}/repo" checkout -q "${SHA}" -- "${MODULE_DIR}"
SRC="${TMP}/repo/${MODULE_DIR}"
if ! ls "${TMP}/repo/${PROTO_PATH}"/*.proto >/dev/null 2>&1; then
  echo "error: no .proto files in ${PROTO_PATH} at ${SHA}; keeping the vendored copy" >&2
  exit 1
fi

# The backend's buf.yaml and buf.lock pin the imports; buf fetches them from the BSR.
(cd "${SRC}" && ${BUF} build --exclude-source-info --path ai_grid/v1 -o "${TMP}/image.binpb")

mkdir -p "${TMP}/out/ai_grid/v1"
cp "${TMP}/repo/${PROTO_PATH}"/*.proto "${TMP}/out/ai_grid/v1/"
mv "${TMP}/image.binpb" "${TMP}/out/image.binpb"
cat > "${TMP}/out/COMMIT" <<COMMIT
# Source of ai_grid/v1/*.proto and image.binpb: the backend's real proto, vendored unchanged.
# Update with hack/sync-upstream-proto.sh <ref>.
repo=${REPO}
commit=${SHA}
path=${PROTO_PATH}
COMMIT
# Swap the directories with a backup, so an interrupted swap leaves one of the two in place.
mv "${UPSTREAM}" "${TMP}/previous"
if ! mv "${TMP}/out" "${UPSTREAM}"; then
  mv "${TMP}/previous" "${UPSTREAM}"
  echo "error: could not replace ${UPSTREAM}; kept the previous copy" >&2
  exit 1
fi
echo "==> ${UPSTREAM} now at ${SHA} (${REF}); run 'make -C bff test' for the drift test"
