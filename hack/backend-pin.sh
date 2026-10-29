#!/usr/bin/env bash
# The backend pin: the ai-grid-provider-backend commit the console is built against and ships with.
# A console version is generated from that commit's API (.backend-api-version, make generate-api)
# and deploys that commit's image, because a newer backend can refuse what an older console sends
# (the first case: ModelSource.name, which backend 1141af0 accepts only empty or as the model's id).
# So every place that names the backend's image names the build of the pinned commit,
# ghcr.io/ai-grid-cloud/ai-grid-provider-backend:sha-<commit>, with its digest:
#   - .backend-api-version: the commit;
#   - charts/ai-grid-provider-console/values.yaml: images.backend.tag and images.backend.digest;
#   - manifests/base/kustomization.yaml: the ai-grid-backend image's newTag and digest;
#   - hack/test-chart-kind.sh: the default BACKEND_IMAGE.
#
#   hack/backend-pin.sh <full commit sha>   # make backend-pin SHA=...: writes all of them (then
#                                           # make generate-api)
#   hack/backend-pin.sh --check             # make check-generated-api: fails when one doesn't name
#                                           # the commit in .backend-api-version
#
# The digest is the registry's, looked up anonymously on ghcr.io. The backend's CI publishes
# sha-<commit> only for a commit on its main, after its checks pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY=ghcr.io/ai-grid-cloud/ai-grid-provider-backend
REGISTRY_PATH=ai-grid-cloud/ai-grid-provider-backend
PIN_FILE=.backend-api-version
VALUES=charts/ai-grid-provider-console/values.yaml
KUSTOMIZATION=manifests/base/kustomization.yaml
KIND_TEST=hack/test-chart-kind.sh

die() {
  echo "backend-pin: $*" >&2
  exit 1
}

# digest_of <commit>: the digest of the sha-<commit> image, or a failure that says why.
digest_of() {
  local tag="sha-$1" token headers status digest
  token="$(curl -fsS --retry 3 "https://ghcr.io/token?scope=repository:${REGISTRY_PATH}:pull" |
    sed -n 's/.*"token":"\([^"]*\)".*/\1/p')" || die "could not get an anonymous pull token from ghcr.io"
  [[ -n "${token}" ]] || die "ghcr.io answered without a pull token"
  headers="$(curl -sS --retry 3 -o /dev/null -D - -I \
    -H "Authorization: Bearer ${token}" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/${REGISTRY_PATH}/manifests/${tag}")" || die "could not reach ghcr.io for ${REPOSITORY}:${tag}"
  status="$(awk 'NR == 1 { print $2 }' <<<"${headers}")"
  if [[ "${status}" == 404 ]]; then
    die "${REPOSITORY}:${tag} is not published. The backend's CI publishes sha-<commit> only for a commit on its main, after its checks pass: wait for that run, or pin a commit that has it."
  fi
  [[ "${status}" == 200 ]] || die "ghcr.io answered ${status} for ${REPOSITORY}:${tag}"
  digest="$(tr -d '\r' <<<"${headers}" | awk 'tolower($1) == "docker-content-digest:" { print $2 }')"
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || die "ghcr.io gave no digest for ${REPOSITORY}:${tag}"
  echo "${digest}"
}

# The YAML keys are read and written by line, inside the block that starts at a line matching
# <start> and ends at the next line indented as much or less: values.yaml's images.backend and
# the kustomization's ai-grid-backend image. No YAML tool, so no other line of the files changes.

# yaml_get <file> <start> <key>: the key's value in the block, empty when it has none.
yaml_get() {
  awk -v start="$2" -v key="$3" '
    function indent(line) { match(line, /^ */); return RLENGTH }
    in_block && NF && indent($0) <= block_indent { in_block = 0 }
    in_block && $1 == key ":" { sub(/^[^:]*:[ ]*/, ""); sub(/[ ]+#.*$/, ""); gsub(/"/, ""); print; exit }
    !in_block && $0 ~ start { in_block = 1; block_indent = indent($0) }
  ' "${ROOT}/$1"
}

# yaml_set <file> <start> <key> <value>: sets the key in the block; fails unless the block has it
# exactly once.
yaml_set() {
  local file=$1 out
  out="$(awk -v start="$2" -v key="$3" -v value="$4" '
    function indent(line) { match(line, /^ */); return RLENGTH }
    in_block && NF && indent($0) <= block_indent { in_block = 0 }
    in_block && $1 == key ":" { match($0, /^ *[^:]*:/); $0 = substr($0, 1, RLENGTH) " " value; found++ }
    !in_block && $0 ~ start { in_block = 1; block_indent = indent($0) }
    { print }
    END { if (found != 1) exit 3 }
  ' "${ROOT}/${file}")" || die "${file}: no single '$3:' line under the line matching '$2'"
  # Written in place, so the file keeps its mode (test-chart-kind.sh is executable).
  printf '%s\n' "${out}" >"${ROOT}/${file}"
}

# The kind test's default image: BACKEND_IMAGE="${BACKEND_IMAGE:-<image>}", matched as text.
# shellcheck disable=SC2016
KIND_PREFIX='BACKEND_IMAGE="${BACKEND_IMAGE:-'
kind_get() {
  # shellcheck disable=SC2016
  sed -n 's/^BACKEND_IMAGE="${BACKEND_IMAGE:-\(.*\)}"$/\1/p' "${ROOT}/${KIND_TEST}"
}
kind_set() {
  local out
  out="$(awk -v line="BACKEND_IMAGE=\"\${BACKEND_IMAGE:-$1}\"" -v prefix="${KIND_PREFIX}" '
    index($0, prefix) == 1 { $0 = line; found++ }
    { print }
    END { if (found != 1) exit 3 }
  ' "${ROOT}/${KIND_TEST}")" || die "${KIND_TEST}: no single BACKEND_IMAGE=\"\${BACKEND_IMAGE:-...}\" line"
  printf '%s\n' "${out}" >"${ROOT}/${KIND_TEST}"
}

VALUES_BLOCK='^  backend:$'
KUSTOMIZATION_BLOCK='^  - name: ai-grid-backend$'

write() {
  local sha=$1 digest
  [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || die "SHA must be one full commit SHA (40 lowercase hex characters), got '${sha}'"
  # Before anything is written, so an unpublished image changes nothing.
  digest="$(digest_of "${sha}")"
  printf '%s\n' "${sha}" >"${ROOT}/${PIN_FILE}"
  yaml_set "${VALUES}" "${VALUES_BLOCK}" repository "${REPOSITORY}"
  yaml_set "${VALUES}" "${VALUES_BLOCK}" tag "sha-${sha}"
  yaml_set "${VALUES}" "${VALUES_BLOCK}" digest "${digest}"
  yaml_set "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" newName "${REPOSITORY}"
  yaml_set "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" newTag "sha-${sha}"
  yaml_set "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" digest "${digest}"
  kind_set "${REPOSITORY}:sha-${sha}@${digest}"
  echo "backend-pin: ${sha}, image ${REPOSITORY}:sha-${sha}@${digest}"
}

check() {
  local sha digest failed=0
  sha="$(tr -d '[:space:]' <"${ROOT}/${PIN_FILE}")"
  [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || die "${PIN_FILE} must hold one full commit SHA, got '${sha}'"
  digest="$(digest_of "${sha}")"
  # expect <file> <what> <found> <expected>
  expect() {
    [[ "$3" == "$4" ]] && return
    echo "backend-pin: $1: $2 is '$3', expected '$4' (the build of ${PIN_FILE}); run: make backend-pin SHA=${sha}" >&2
    failed=1
  }
  expect "${VALUES}" images.backend.repository "$(yaml_get "${VALUES}" "${VALUES_BLOCK}" repository)" "${REPOSITORY}"
  expect "${VALUES}" images.backend.tag "$(yaml_get "${VALUES}" "${VALUES_BLOCK}" tag)" "sha-${sha}"
  expect "${VALUES}" images.backend.digest "$(yaml_get "${VALUES}" "${VALUES_BLOCK}" digest)" "${digest}"
  expect "${KUSTOMIZATION}" "ai-grid-backend newName" "$(yaml_get "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" newName)" "${REPOSITORY}"
  expect "${KUSTOMIZATION}" "ai-grid-backend newTag" "$(yaml_get "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" newTag)" "sha-${sha}"
  expect "${KUSTOMIZATION}" "ai-grid-backend digest" "$(yaml_get "${KUSTOMIZATION}" "${KUSTOMIZATION_BLOCK}" digest)" "${digest}"
  expect "${KIND_TEST}" "the default BACKEND_IMAGE" "$(kind_get)" "${REPOSITORY}:sha-${sha}@${digest}"
  ((failed == 0)) || exit 1
  echo "backend-pin: every place names ${REPOSITORY}:sha-${sha}@${digest}"
}

case "${1:-}" in
  --check) check ;;
  "" | -*) die "usage: hack/backend-pin.sh <full commit sha> | --check" ;;
  *) write "$1" ;;
esac
