#!/usr/bin/env bash
# do-common.sh: shared helpers for provision-droplet.sh and destroy-droplet.sh.
# Sourced, not run. Works with macOS bash 3.2.
#
# Conventions:
#   - progress and plans go to stderr; stdout carries only the final result
#     (ids and IPs), so `out=$(provision-droplet.sh ...)` gets clean values
#   - run() executes its arguments directly. It never uses eval, which would
#     re-split a quoted multi-rule firewall argument and silently drop rules
#   - nothing here prints a token, an API response body, or user data

DO_COMMON_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=../lib/load-env.sh
. "$DO_COMMON_DIR/../lib/load-env.sh"

DRY_RUN=${DRY_RUN:-0}
ASSUME_YES=${ASSUME_YES:-0}

say()  { printf '\n== %s\n' "$*" >&2; }
info() { printf '   %s\n' "$*" >&2; }
ok()   { printf '   ok     %s\n' "$*" >&2; }
todo() { printf '   todo   %s\n' "$*" >&2; }
warn() { printf '   WARN   %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# Show a command as it would run. A word with spaces or odd characters is shown
# in single quotes, so you can see it travels as ONE argument (the firewall
# rules, for example).
show_cmd() {
  local prefix=$1 w
  shift
  printf '   %s' "$prefix" >&2
  for w in "$@"; do
    case $w in
      '' | *[!A-Za-z0-9_./:=@,+%-]*) printf " '%s'" "$(printf '%s' "$w" | sed "s/'/'\\\\''/g")" >&2 ;;
      *) printf ' %s' "$w" >&2 ;;
    esac
  done
  printf '\n' >&2
}

# run CMD ARGS... : execute, or in dry-run mode just show it.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    show_cmd 'would run:' "$@"
  else
    show_cmd '$' "$@"
    "$@"
  fi
}

need_arg() { [ "$2" -ge 2 ] || die "$1 needs a value (see --help)"; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "$c is not installed (macOS: brew install $c)"
  done
}

is_yes_no() { case $1 in yes | no) return 0 ;; *) return 1 ;; esac; }

# confirm "question": ask once. --yes skips it. With no terminal and no --yes
# it refuses, so an agent can't sail past the question on its own.
confirm() {
  local answer
  if [ "$ASSUME_YES" = 1 ]; then
    info "--yes given: going ahead"
    return 0
  fi
  if [ ! -t 0 ]; then
    die "no terminal to ask on. Re-run with --yes only after a person has read the plan above and said go."
  fi
  printf '\n%s [y/N] ' "$1" >&2
  read -r answer || answer=
  case $answer in y | Y | yes | YES) return 0 ;; esac
  die "stopped. Nothing was changed."
}

# Load the token from the env file, the environment or the Keychain.
load_token() {
  load_env --file "$ENV_FILE" DIGITALOCEAN_ACCESS_TOKEN ||
    die "no DigitalOcean token. Put DIGITALOCEAN_ACCESS_TOKEN in $ENV_FILE (chmod 600), or in the Keychain with KEYCHAIN_SERVICE set. See scripts/do/do.env.example."
  # doctl reads DIGITALOCEAN_ACCESS_TOKEN from the environment, so the token
  # never appears on a command line.
  export DIGITALOCEAN_ACCESS_TOKEN
}

# Rough monthly prices in USD, used only when we can't ask the API (dry run).
approx_price() {
  case $1 in
    s-1vcpu-512mb-10gb) echo 4 ;;
    s-1vcpu-1gb) echo 6 ;;
    s-1vcpu-2gb) echo 12 ;;
    s-2vcpu-2gb) echo 18 ;;
    s-2vcpu-4gb) echo 24 ;;
    s-4vcpu-8gb) echo 48 ;;
    *) echo "?" ;;
  esac
}

# One small JSON reader for doctl's `-o json` output. Prints space-separated
# fields, with "-" for an empty field, so bash can `read` them. It never
# prints whole objects. (Single-quoted for bash, so no single quotes inside.)
DO_JSON_PY='
import json, sys
mode, args = sys.argv[1], sys.argv[2:]
raw = sys.stdin.read().strip()
data = json.loads(raw) if raw else []
if data is None:
    data = []
if isinstance(data, dict):
    data = [data]

def out(*vals):
    print(" ".join("-" if v in (None, "") else str(v) for v in vals))

def droplet_id_of(rip):
    d = rip.get("droplet") or {}
    return str(d.get("id") or "")

def region_of(obj):
    return (obj.get("region") or {}).get("slug", "")

if mode == "sshkey":
    keys = [k for k in data if k.get("name") == args[0]]
    if len(keys) == 1:
        out(1, keys[0].get("id"), keys[0].get("fingerprint"))
    else:
        out(len(keys))

elif mode == "droplet":
    ds = [d for d in data if d.get("name") == args[0]]
    if len(ds) != 1:
        out(len(ds))
    else:
        d = ds[0]
        ip = ""
        for n in (d.get("networks") or {}).get("v4") or []:
            if n.get("type") == "public":
                ip = n.get("ip_address")
                break
        out(1, d.get("id"), ip, ",".join(d.get("tags") or []))

elif mode == "rip":
    did, region, pin = args[0], args[1], args[2]
    for r in data:
        if did and droplet_id_of(r) == did:
            out("assigned", r.get("ip"))
            sys.exit()
    if pin:
        for r in data:
            if r.get("ip") == pin:
                if droplet_id_of(r):
                    out("busy", pin, droplet_id_of(r))
                elif region_of(r) != region:
                    out("wrong-region", pin, region_of(r))
                else:
                    out("free", pin, 1)
                sys.exit()
        out("not-found", pin)
        sys.exit()
    free = [r.get("ip") for r in data if not droplet_id_of(r) and region_of(r) == region]
    if free:
        out("free", free[0], len(free))
    else:
        out("none")

elif mode == "rip-of":
    did = args[0]
    ips = [r.get("ip") for r in data if droplet_id_of(r) == did]
    out(len(ips), *ips)

elif mode == "rip-get":
    pin = args[0]
    for r in data:
        if r.get("ip") == pin:
            out("found", droplet_id_of(r) or "")
            sys.exit()
    out("not-found")

elif mode == "fw":
    # args: name, this droplet id, tag, and optionally a comma list of droplet
    # ids that still exist (stale ids of deleted droplets are not "others")
    name, did, tag = args[0], args[1], args[2]
    alive = set(x for x in args[3].split(",") if x) if len(args) > 3 else None
    fws = [f for f in data if f.get("name") == name]
    if not fws:
        out("none")
    elif len(fws) > 1:
        out("dup", len(fws))
    else:
        f = fws[0]
        ids = [str(x) for x in f.get("droplet_ids") or []]
        tags = f.get("tags") or []
        others = [x for x in ids if x != did and (alive is None or x in alive)]
        out("found", f.get("id"), "yes" if did and did in ids else "no",
            "yes" if tag in tags else "no", len(others))

elif mode == "records":
    name = args[0]
    recs = [r for r in data if r.get("type") == "A" and r.get("name") == name]
    if len(recs) == 1:
        out(1, recs[0].get("id"), recs[0].get("data"))
    else:
        out(len(recs))

elif mode == "records-matching":
    name, ips = args[0], set(args[1:])
    ids = [str(r.get("id")) for r in data
           if r.get("type") == "A" and r.get("name") == name and r.get("data") in ips]
    out(len(ids), *ids)

elif mode == "price":
    for s in data:
        if s.get("slug") == args[0]:
            out(s.get("price_monthly"))
            break
    else:
        out("?")

elif mode == "snapshots":
    did = args[0]
    snaps = [s for s in data if str(s.get("resource_id")) == did]
    out(len(snaps), round(sum(float(s.get("size_gigabytes") or 0) for s in snaps), 1))

elif mode == "count":
    out(len(data))

elif mode == "ids":
    out(",".join(str(d.get("id")) for d in data) or "")

else:
    sys.exit("unknown mode " + mode)
'

# pyjson MODE ARGS... < json
pyjson() { python3 -c "$DO_JSON_PY" "$@"; }

# Fill D_COUNT D_ID D_IP D_TAGS for the droplet named $1.
inspect_droplet() {
  local line
  line=$(doctl compute droplet list -o json | pyjson droplet "$1")
  D_COUNT=- D_ID=- D_IP=- D_TAGS=-
  # shellcheck disable=SC2034 # D_COUNT is read by the scripts that source this file
  read -r D_COUNT D_ID D_IP D_TAGS <<EOF
$line
EOF
  [ "$D_ID" = - ] && D_ID=
  [ "$D_IP" = - ] && D_IP=
  [ "$D_TAGS" = - ] && D_TAGS=
  return 0
}

has_tag() { # has_tag "a,b,c" b
  case ",$1," in *",$2,"*) return 0 ;; *) return 1 ;; esac
}

# DNS check from the public internet's point of view (best effort).
dig_a() {
  if command -v dig >/dev/null 2>&1; then
    dig +short +time=3 +tries=1 A "$1" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//'
  fi
}

dig_ns_is_do() {
  command -v dig >/dev/null 2>&1 || return 2
  dig +short +time=3 +tries=1 NS "$1" 2>/dev/null | grep -qi 'ns[0-9]\.digitalocean\.com'
}
