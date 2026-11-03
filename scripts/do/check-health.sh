#!/usr/bin/env bash
# check-health.sh: ask the app's /health endpoint how it is, from OUTSIDE the
# server (your laptop), and explain what a failure means.
#
#   scripts/do/check-health.sh https://maps.example.com
#   scripts/do/check-health.sh https://maps.example.com/health --expect-commit 1a2b3c4
#   scripts/do/check-health.sh https://maps.example.com --resolve 203.0.113.10
#   scripts/do/check-health.sh http://203.0.113.10/health --wait 600
#
# A URL without a path gets /health added.
#
# Options:
#   --expect-commit SHA   healthy only if the reported commit starts with SHA
#                         (or SHA starts with it; short and long SHAs both work)
#   --commit-field NAME   JSON field holding the commit (default commit_sha)
#   --resolve IP          skip DNS and connect to IP, still sending the right
#                         hostname (test a new server before DNS points at it)
#   --wait SECONDS        keep trying until healthy or SECONDS have passed
#   --interval SECONDS    pause between tries with --wait (default 10)
#   --max-time SECONDS    give up on one try after this long (default 10)
#
# Timeouts come from curl itself (--connect-timeout, --max-time), because macOS
# has no `timeout` command. A script that runs `timeout 5 curl ...` on a Mac gets
# "command not found", and its `|| echo DOWN` reports an outage that isn't there.
#
# stdout: one verdict line. Exit 0 = healthy, 1 = not, 2 = bad arguments.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }

URL="" EXPECT="" FIELD=commit_sha RESOLVE_IP="" WAIT=0 INTERVAL=10 MAXT=10
while [ $# -gt 0 ]; do
  case $1 in
    --expect-commit) [ $# -ge 2 ] || die "$1 needs a value"; EXPECT=$2; shift ;;
    --commit-field) [ $# -ge 2 ] || die "$1 needs a value"; FIELD=$2; shift ;;
    --resolve) [ $# -ge 2 ] || die "$1 needs a value"; RESOLVE_IP=$2; shift ;;
    --wait) [ $# -ge 2 ] || die "$1 needs a value"; WAIT=$2; shift ;;
    --interval) [ $# -ge 2 ] || die "$1 needs a value"; INTERVAL=$2; shift ;;
    --max-time) [ $# -ge 2 ] || die "$1 needs a value"; MAXT=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) [ -z "$URL" ] || die "only one URL, please"; URL=$1 ;;
  esac
  shift
done
[ -n "$URL" ] || { usage >&2; exit 2; }
for n in "$WAIT" "$INTERVAL" "$MAXT"; do
  case $n in '' | *[!0-9]*) die "--wait, --interval and --max-time take whole seconds" ;; esac
done
case $URL in http://* | https://*) ;; *) die "the URL must start with http:// or https://" ;; esac
case $EXPECT in *[!0-9a-fA-F]*) die "--expect-commit takes a hex commit SHA" ;; esac
case $FIELD in '' | *[!A-Za-z0-9_.]*) die "--commit-field looks wrong" ;; esac
case $RESOLVE_IP in *[!0-9a-fA-F:.]*) die "--resolve takes an IP address" ;; esac

# Add /health when the URL has no path.
rest=${URL#*://}
case $rest in */*) ;; *) URL="$URL/health" ;; esac

scheme=${URL%%://*}
hostport=${rest%%/*}
host=${hostport%%:*}
port=${hostport##*:}
[ "$port" = "$hostport" ] && { [ "$scheme" = https ] && port=443 || port=80; }

command -v curl >/dev/null 2>&1 || die "curl is not installed"
BODY=$(mktemp "${TMPDIR:-/tmp}/health.XXXXXX")
ERR=$(mktemp "${TMPDIR:-/tmp}/health-err.XXXXXX")
trap 'rm -f "$BODY" "$ERR"' EXIT

VERDICT="" HEALTHY=1

# Summarise the JSON body: status, version, commit. Never prints the whole body.
summarise_json() {
  python3 - "$BODY" "$FIELD" "$EXPECT" <<'PY'
import json, sys
path, field, expect = sys.argv[1], sys.argv[2], sys.argv[3].lower()
try:
    data = json.load(open(path, encoding="utf-8", errors="replace"))
except Exception:
    print("NOJSON")
    sys.exit()
if not isinstance(data, dict):
    print("NOJSON")
    sys.exit()
val = data
for part in field.split("."):
    val = val.get(part) if isinstance(val, dict) else None
status = str(data.get("status", "")).lower() or "?"
version = str(data.get("version", "") or "-")
commit = str(val or "")
verdict = "OK"
if status not in ("ok", "healthy", "pass", "up", "?"):
    verdict = "BADSTATUS"
if expect:
    if not commit:
        verdict = "NOCOMMIT"
    elif not (commit.lower().startswith(expect) or expect.startswith(commit.lower())):
        verdict = "OLDCOMMIT"
print(verdict, status, version, (commit[:12] or "-"))
PY
}

check_once() {
  local code rc=0 ctype args summary verdict status version commit
  args=(-sS -o "$BODY" -w '%{http_code} %{content_type}' --connect-timeout 5 --max-time "$MAXT"
    -H 'Accept: application/json' -A 'check-health/1')
  if [ -n "$RESOLVE_IP" ]; then args+=(--resolve "$host:$port:$RESOLVE_IP"); fi
  : >"$BODY"
  code=$(curl "${args[@]}" "$URL" 2>"$ERR") || rc=$?
  ctype=${code#* }
  code=${code%% *}
  HEALTHY=1
  case $rc in
    0) ;;
    6) VERDICT="DNS: can't resolve $host. The record is missing, not propagated yet, or mistyped. (Test the server anyway with --resolve <ip>.)"; return ;;
    7) VERDICT="REFUSED: reached the address, but nothing accepted a connection on port $port. Caddy isn't running yet, cloud-init is still going, or a firewall rejects it."; return ;;
    28) VERDICT="TIMEOUT after ${MAXT}s: no answer. A firewall is dropping packets, the IP is wrong, or the server is overloaded."; return ;;
    35 | 51 | 53 | 54 | 58 | 59 | 60 | 77 | 80 | 82 | 83 | 90 | 91)
      VERDICT="TLS: the HTTPS handshake failed (curl $rc). Usually the certificate isn't issued yet: DNS doesn't point here, port 80/443 is closed, or Let's Encrypt rate-limited you. Check the Caddy logs."; return ;;
    52) VERDICT="EMPTY: the server closed the connection without answering. Often plain HTTP sent to an HTTPS port, or the other way round."; return ;;
    56) VERDICT="RESET: the connection was cut mid-way (curl 56). A proxy or firewall in the middle, or the app crashing."; return ;;
    *) VERDICT="CURL $rc: $(head -c 200 "$ERR" | tr '\n' ' ')"; return ;;
  esac
  case $code in
    2??)
      case $ctype in
        *html*) VERDICT="HTML: got a web page, not health JSON. The /health route is falling through to the app's index.html (add an exact /health route before the SPA fallback)."; return ;;
      esac
      summary=$(summarise_json)
      read -r verdict status version commit <<EOF
$summary
EOF
      case $verdict in
        OK) HEALTHY=0; VERDICT="HEALTHY: HTTP $code, status $status, version $version, commit $commit" ;;
        NOJSON) if [ -z "$EXPECT" ]; then HEALTHY=0; VERDICT="HEALTHY: HTTP $code (body isn't JSON, so no status or commit to read)"; else VERDICT="NO COMMIT: HTTP $code, but the body isn't JSON, so the commit can't be checked"; fi ;;
        BADSTATUS) VERDICT="UNHEALTHY: HTTP $code, but the app reports status $status (version $version, commit $commit)" ;;
        NOCOMMIT) VERDICT="NO COMMIT: HTTP $code, status $status, but no '$FIELD' field to compare. Add it to /health (docs/08, section 8)." ;;
        OLDCOMMIT) VERDICT="OLD BUILD: HTTP $code, status $status, running commit $commit, expected $EXPECT. Not redeployed yet, or 'Re-pull image' was off." ;;
      esac
      ;;
    301 | 302 | 307 | 308) VERDICT="REDIRECT: HTTP $code. Use the final URL (often https:// instead of http://)." ;;
    401 | 403) VERDICT="BLOCKED: HTTP $code. Something asks for login in front of /health. Mount /health before the auth middleware or proxy auth." ;;
    404) VERDICT="NOT FOUND: HTTP 404. You reached a server, so DNS, TLS and the proxy work; that path doesn't exist. Check the URL (/health or /api/health?)." ;;
    502 | 503 | 504) VERDICT="PROXY UP, APP DOWN: HTTP $code. DNS, the certificate and Caddy are all fine; the container behind it isn't answering. Check 'docker compose ps' and the logs on the server." ;;
    5??) VERDICT="APP ERROR: HTTP $code. The app answered with an error; check its logs." ;;
    *) VERDICT="HTTP $code: unexpected answer." ;;
  esac
}

deadline=$(($(date +%s) + WAIT))
attempt=0
while :; do
  attempt=$((attempt + 1))
  check_once
  if [ "$HEALTHY" = 0 ] || [ "$(date +%s)" -ge "$deadline" ]; then break; fi
  printf 'try %s: %s\n' "$attempt" "$VERDICT" >&2
  sleep "$INTERVAL"
done

printf '%s  [%s]\n' "$VERDICT" "$URL${RESOLVE_IP:+ via $RESOLVE_IP}"
exit "$HEALTHY"
