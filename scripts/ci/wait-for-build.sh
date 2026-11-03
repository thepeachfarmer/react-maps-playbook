#!/usr/bin/env bash
# wait-for-build.sh: wait for GitHub Actions to finish building a commit before
# you deploy it. Deploy too early and the server pulls the PREVIOUS image.
#
#   scripts/ci/wait-for-build.sh                        the current HEAD
#   scripts/ci/wait-for-build.sh --sha origin/main --workflow build.yml
#   scripts/ci/wait-for-build.sh --dry-run
#
# It finds the workflow run(s) for the commit (waiting for them to appear,
# since a run can take a moment to start after a push), then follows each one
# with `gh run watch`. Exit 0 only when every matching run succeeded.
#
# Options:
#   --sha REF          commit SHA or git ref (default HEAD; it must be pushed)
#   --workflow NAME    only this workflow (file name like build.yml, or its name)
#   --branch BRANCH    only runs on this branch (default: any)
#   --event EVENT      only runs for this event (default push; use "" for any)
#   --repo OWNER/REPO  default: the repo in the current directory
#   --timeout SECONDS  give up after this long overall (default 1800)
#   --appear SECONDS   how long to wait for a run to show up (default 180)
#   --dry-run          print what it would do; no calls to GitHub
#
# Needs: gh (logged in with `gh auth login`, which keeps its token in the macOS
# Keychain, not in a file) and git. Uses a polling loop rather than `timeout`,
# which macOS doesn't have.
#
# stdout: one line per run, e.g. "run=123456 conclusion=success url=https://github.com/..."
# Exit 0 = every run green, 1 = not green, timed out or couldn't check, 2 = bad arguments.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }   # bad arguments only
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }  # everything else that stops it
info() { printf '%s\n' "$*" >&2; }

REF=HEAD WORKFLOW="" BRANCH="" EVENT=push REPO="" TIMEOUT=1800 APPEAR=180 DRY_RUN=0
while [ $# -gt 0 ]; do
  case $1 in
    --sha) [ $# -ge 2 ] || die "$1 needs a value"; REF=$2; shift ;;
    --workflow) [ $# -ge 2 ] || die "$1 needs a value"; WORKFLOW=$2; shift ;;
    --branch) [ $# -ge 2 ] || die "$1 needs a value"; BRANCH=$2; shift ;;
    --event) [ $# -ge 2 ] || die "$1 needs a value"; EVENT=$2; shift ;;
    --repo) [ $# -ge 2 ] || die "$1 needs a value"; REPO=$2; shift ;;
    --timeout) [ $# -ge 2 ] || die "$1 needs a value"; TIMEOUT=$2; shift ;;
    --appear) [ $# -ge 2 ] || die "$1 needs a value"; APPEAR=$2; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
case $TIMEOUT$APPEAR in '' | *[!0-9]*) die "--timeout and --appear take whole seconds" ;; esac

if SHA=$(git rev-parse --verify --quiet "$REF^{commit}" 2>/dev/null); then
  :
elif [ "$DRY_RUN" = 1 ]; then
  SHA="<sha of $REF>"
else
  die "can't resolve '$REF' to a commit here"
fi

# Shared filters for `gh run list`.
FILTERS=(--commit "$SHA")
if [ -n "$WORKFLOW" ]; then FILTERS+=(--workflow "$WORKFLOW"); fi
if [ -n "$BRANCH" ]; then FILTERS+=(--branch "$BRANCH"); fi
if [ -n "$EVENT" ]; then FILTERS+=(--event "$EVENT"); fi
if [ -n "$REPO" ]; then FILTERS+=(--repo "$REPO"); fi

if [ "$DRY_RUN" = 1 ]; then
  info "DRY RUN: no calls to GitHub"
  info "  commit: $SHA"
  info "  would poll every 10s for up to ${APPEAR}s:  gh run list ${FILTERS[*]} --json databaseId,status,conclusion,url,workflowName"
  info "  then for each run:  gh run watch <run-id>${REPO:+ --repo $REPO} --exit-status --interval 10   (stopped after ${TIMEOUT}s overall)"
  info "  and read the result:  gh run view <run-id>${REPO:+ --repo $REPO} --json conclusion,url"
  exit 0
fi

command -v gh >/dev/null 2>&1 || fail "gh is not installed (brew install gh), or not on PATH"
gh auth status >/dev/null 2>&1 || fail "gh isn't logged in. Run: gh auth login"

# Is this commit on GitHub at all? (A commit that was never pushed never builds.)
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  if ! git branch -r --contains "$SHA" 2>/dev/null | grep -q .; then
    info "warning: no remote branch contains ${SHA:0:12}. Did you push it?"
  fi
fi

start=$(date +%s)
deadline=$((start + TIMEOUT))
appear_by=$((start + APPEAR))

RUNS=""
while :; do
  RUNS=$(gh run list "${FILTERS[@]}" --limit 20 --json databaseId,status,conclusion,url,workflowName \
    | python3 -c 'import json,sys; [print(r["databaseId"]) for r in json.load(sys.stdin)]')
  [ -n "$RUNS" ] && break
  if [ "$(date +%s)" -ge "$appear_by" ]; then
    fail "no workflow run for ${SHA:0:12} after ${APPEAR}s (filters: ${FILTERS[*]}). Pushed? Right --workflow/--event?"
  fi
  info "waiting for a run of ${SHA:0:12} to appear..."
  sleep 10
done

failed=0
for id in $RUNS; do
  info "watching run $id"
  gh run watch "$id" ${REPO:+--repo "$REPO"} --exit-status --interval 10 >&2 &
  pid=$!
  timed_out=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      kill "$pid" 2>/dev/null || true
      timed_out=1
      break
    fi
    sleep 5
  done
  wait "$pid" 2>/dev/null || true
  read -r conclusion url <<EOF
$(gh run view "$id" ${REPO:+--repo "$REPO"} --json conclusion,url \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r.get("conclusion") or "pending", r.get("url") or "-")')
EOF
  if [ "$timed_out" = 1 ]; then conclusion="timed-out-waiting"; fi
  printf 'run=%s conclusion=%s url=%s\n' "$id" "$conclusion" "$url"
  if [ "$conclusion" != success ]; then failed=1; fi
done

if [ "$failed" = 0 ]; then
  info "CI is green for ${SHA:0:12}. Safe to deploy."
  exit 0
fi
info "CI did not succeed for ${SHA:0:12}. Don't deploy."
exit 1
