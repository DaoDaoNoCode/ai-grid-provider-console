#!/usr/bin/env bash
# Prints the directory of an ai-grid-provider-backend checkout to run (make dev-fake-infra):
#   - BACKEND_DIR when it is set: your own checkout, used as it is (a warning when its HEAD is not
#     the commit in .backend-api-version, whose API the frontend's src/gen was generated from);
#   - otherwise .cache/backend/<sha>, a checkout of the commit in .backend-api-version from
#     BACKEND_REPO, fetched (that commit only) the first time and reused after. .cache/ is
#     gitignored; delete the directory to fetch it again.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(tr -d '[:space:]' <"${ROOT}/.backend-api-version")"
REPO="${BACKEND_REPO:-https://github.com/ai-grid-cloud/ai-grid-provider-backend.git}"

if [[ ! "${SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "backend-checkout: .backend-api-version must hold one full commit SHA, got '${SHA}'" >&2
  exit 1
fi

if [[ -n "${BACKEND_DIR:-}" ]]; then
  if [[ ! -f "${BACKEND_DIR}/Makefile" ]]; then
    echo "backend-checkout: BACKEND_DIR=${BACKEND_DIR} is not an ai-grid-provider-backend checkout" >&2
    exit 1
  fi
  head="$(git -C "${BACKEND_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [[ "${head}" != "${SHA}" ]]; then
    echo "backend-checkout: BACKEND_DIR is at ${head}, not ${SHA} (.backend-api-version); running it anyway" >&2
  fi
  cd "${BACKEND_DIR}" && pwd
  exit 0
fi

dir="${ROOT}/.cache/backend/${SHA}"
# A cached checkout is used only while it is still the pinned commit, with no tracked file
# changed (the build's own output is untracked); otherwise it is fetched again.
if [[ -d "${dir}" ]]; then
  head=none changes=""
  # Its own repository only: without .git, git would answer for the console's checkout around it.
  if [[ -d "${dir}/.git" ]]; then
    head="$(git -C "${dir}" rev-parse HEAD 2>/dev/null || echo none)"
    changes="$(git -C "${dir}" status --porcelain --untracked-files=no 2>/dev/null || echo unreadable)"
  fi
  if [[ "${head}" != "${SHA}" || -n "${changes}" ]]; then
    echo "backend-checkout: ${dir} is at ${head}$([[ -n "${changes}" ]] && echo ", with changes"), not a clean ${SHA}; fetching it again" >&2
    rm -rf "${dir}"
  fi
fi
if [[ ! -d "${dir}" ]]; then
  echo "backend-checkout: fetching ${REPO} at ${SHA} into ${dir}" >&2
  tmp="${dir}.partial"
  rm -rf "${tmp}"
  mkdir -p "${tmp}"
  git -C "${tmp}" init -q
  git -C "${tmp}" fetch -q --depth 1 "${REPO}" "${SHA}"
  git -C "${tmp}" checkout -q --detach FETCH_HEAD
  # Only a complete checkout gets the name: an interrupted fetch is retried next time.
  mv "${tmp}" "${dir}"
fi
echo "${dir}"
