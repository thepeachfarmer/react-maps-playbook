#!/usr/bin/env bash
# provision-droplet.sh: create (or repair) one DigitalOcean droplet for the app.
#
#   scripts/do/provision-droplet.sh --dry-run    show the plan; no token, no API calls
#   scripts/do/provision-droplet.sh --check      read-only: is everything in place?
#   scripts/do/provision-droplet.sh              look, show the plan, ask, then do it
#
# What it sets up, each step skipped when it's already right (safe to re-run):
#   1. checks that the SSH key you named is on the account AND that its private
#      half is on this machine (otherwise you'd pay for a droplet you can't log into)
#   2. the droplet: size, region, image, your SSH key, a tag, monitoring, backups,
#      and cloud-init user data (scripts/do/cloud-init.yaml) that installs Docker,
#      a non-root user and the app behind Caddy
#   3. a reserved (static) IP: reuses an unassigned one in the region before
#      buying another
#   4. a cloud firewall (22/80/443 in) attached BY TAG, so a re-created droplet
#      is covered too; the script checks the droplet really is covered
#   5. optionally, the DNS A record in DigitalOcean DNS
#
# stdout gets two lines and nothing else:  droplet_id=...  and  ip=...
# Everything else (the plan, progress) goes to stderr. The token is never printed.
#
# Settings come from flags, then the environment, then the env file
# (default secrets/do.env; see scripts/do/do.env.example):
#   --name NAME            DROPLET_NAME   (default maps-demo)
#   --region SLUG          REGION         (default nyc3)
#   --size SLUG            SIZE           (default s-1vcpu-1gb)
#   --image SLUG           IMAGE          (default ubuntu-24-04-x64)
#   --ssh-key NAME         SSH_KEY_NAME   (required: a key name on your DO account)
#   --tag TAG              TAG            (default: the droplet name)
#   --user-data FILE       USER_DATA      (default scripts/do/cloud-init.yaml)
#   --app-image IMAGE      APP_IMAGE      (default ghcr.io/your-org/react-maps-example:latest)
#   --domain DOMAIN        DOMAIN         (e.g. example.com; empty = plain HTTP on the IP)
#   --record NAME          RECORD         (e.g. maps for maps.example.com; @ = the domain itself)
#   --manage-dns yes|no    MANAGE_DNS     (default no: you add the A record where your DNS lives)
#   --reserved-ip yes|no   RESERVED_IP    (default yes)
#   --reserved-ip-address IP  RESERVED_IP_ADDRESS (reuse this exact reserved IP)
#   --ssh-from CIDRS       SSH_FROM       (default 0.0.0.0/0,::/0; e.g. 203.0.113.10/32)
#   --backups yes|no       BACKUPS        (default yes, weekly: about +20% of the droplet price)
#   --env-file PATH        DO_ENV_FILE    (default secrets/do.env)
#   --keychain-service NAME KEYCHAIN_SERVICE (look in the macOS Keychain under NAME too)
#   --yes                  don't ask before changing things (only after a person approved the plan)
#
# Needs: doctl, python3, ssh-keygen. The token comes from DIGITALOCEAN_ACCESS_TOKEN
# in the environment, the env file, or the macOS Keychain (KEYCHAIN_SERVICE=... or
# --keychain-service ...).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=do-common.sh
. "$SCRIPT_DIR/do-common.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

CHECK=0
ENV_FILE=${DO_ENV_FILE:-secrets/do.env}
F_NAME="" F_REGION="" F_SIZE="" F_IMAGE="" F_SSH_KEY="" F_TAG="" F_USER_DATA=""
F_APP_IMAGE="" F_DOMAIN="" F_RECORD="" F_MANAGE_DNS="" F_RESERVED_IP="" F_RIP_ADDR=""
F_SSH_FROM="" F_BACKUPS=""

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --check) CHECK=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --env-file) need_arg "$1" $#; ENV_FILE=$2; shift ;;
    --keychain-service) need_arg "$1" $#; KEYCHAIN_SERVICE=$2; export KEYCHAIN_SERVICE; shift ;;
    --name) need_arg "$1" $#; F_NAME=$2; shift ;;
    --region) need_arg "$1" $#; F_REGION=$2; shift ;;
    --size) need_arg "$1" $#; F_SIZE=$2; shift ;;
    --image) need_arg "$1" $#; F_IMAGE=$2; shift ;;
    --ssh-key) need_arg "$1" $#; F_SSH_KEY=$2; shift ;;
    --tag) need_arg "$1" $#; F_TAG=$2; shift ;;
    --user-data) need_arg "$1" $#; F_USER_DATA=$2; shift ;;
    --app-image) need_arg "$1" $#; F_APP_IMAGE=$2; shift ;;
    --domain) need_arg "$1" $#; F_DOMAIN=$2; shift ;;
    --record) need_arg "$1" $#; F_RECORD=$2; shift ;;
    --manage-dns) need_arg "$1" $#; F_MANAGE_DNS=$2; shift ;;
    --reserved-ip) need_arg "$1" $#; F_RESERVED_IP=$2; shift ;;
    --reserved-ip-address) need_arg "$1" $#; F_RIP_ADDR=$2; shift ;;
    --ssh-from) need_arg "$1" $#; F_SSH_FROM=$2; shift ;;
    --backups) need_arg "$1" $#; F_BACKUPS=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done
[ "$DRY_RUN" = 1 ] && [ "$CHECK" = 1 ] && die "pick one of --dry-run and --check"

# Non-secret settings may live in the env file too. load_env only fills
# variables that aren't already set, and only the names listed here.
load_env --file "$ENV_FILE" --optional DROPLET_NAME REGION SIZE IMAGE SSH_KEY_NAME TAG \
  USER_DATA APP_IMAGE DOMAIN RECORD MANAGE_DNS RESERVED_IP RESERVED_IP_ADDRESS SSH_FROM \
  BACKUPS BACKUP_PLAN KEYCHAIN_SERVICE

NAME=${F_NAME:-${DROPLET_NAME:-maps-demo}}
REGION=${F_REGION:-${REGION:-nyc3}}
SIZE=${F_SIZE:-${SIZE:-s-1vcpu-1gb}}
IMAGE=${F_IMAGE:-${IMAGE:-ubuntu-24-04-x64}}
SSH_KEY_NAME=${F_SSH_KEY:-${SSH_KEY_NAME:-}}
TAG=${F_TAG:-${TAG:-$NAME}}
USER_DATA=${F_USER_DATA:-${USER_DATA:-$SCRIPT_DIR/cloud-init.yaml}}
APP_IMAGE=${F_APP_IMAGE:-${APP_IMAGE:-ghcr.io/your-org/react-maps-example:latest}}
DOMAIN=${F_DOMAIN:-${DOMAIN:-}}
RECORD=${F_RECORD:-${RECORD:-@}}
MANAGE_DNS=${F_MANAGE_DNS:-${MANAGE_DNS:-no}}
RESERVED_IP=${F_RESERVED_IP:-${RESERVED_IP:-yes}}
RIP_ADDR=${F_RIP_ADDR:-${RESERVED_IP_ADDRESS:-}}
SSH_FROM=${F_SSH_FROM:-${SSH_FROM:-0.0.0.0/0,::/0}}
BACKUPS=${F_BACKUPS:-${BACKUPS:-yes}}
BACKUP_PLAN=${BACKUP_PLAN-weekly}
FW_NAME="$NAME-fw"

# ---- validate settings (cheap, local, before anything else) -------------------
case $NAME in '' | *[!a-z0-9.-]* | [.-]*) die "droplet name must be lowercase letters, digits, dots and dashes: $NAME" ;; esac
case $TAG in '' | *[!A-Za-z0-9:_-]*) die "tag may contain letters, digits, colons, dashes and underscores: $TAG" ;; esac
case $REGION$SIZE$IMAGE in *[!a-z0-9-]*) die "region, size and image are slugs like nyc3, s-1vcpu-1gb, ubuntu-24-04-x64" ;; esac
case $APP_IMAGE in '' | *[!A-Za-z0-9./_:@-]*) die "app image looks wrong: $APP_IMAGE" ;; esac
case $DOMAIN in *[!A-Za-z0-9.-]*) die "domain looks wrong: $DOMAIN" ;; esac
case $RECORD in '@') ;; '' | *[!A-Za-z0-9.-]*) die "record should be a name like maps, or @" ;; esac
case $SSH_FROM in '' | *[!0-9A-Fa-f:./,]*) die "SSH_FROM should be comma-separated CIDRs like 203.0.113.10/32" ;; esac
case $RIP_ADDR in *[!0-9.]*) die "reserved IP address should look like 203.0.113.10" ;; esac
for v in MANAGE_DNS RESERVED_IP BACKUPS; do
  eval "val=\$$v"
  # shellcheck disable=SC2154
  is_yes_no "$val" || die "$v must be yes or no (got: $val)"
done
case $BACKUP_PLAN in '' | daily | weekly) ;; *) die "BACKUP_PLAN must be daily, weekly or empty" ;; esac
[ -f "$USER_DATA" ] || die "user data file not found: $USER_DATA"
if [ "$MANAGE_DNS" = yes ] && [ -z "$DOMAIN" ]; then die "--manage-dns yes needs --domain"; fi
if [ "$RESERVED_IP" = no ] && [ -n "$RIP_ADDR" ]; then die "--reserved-ip-address needs --reserved-ip yes"; fi

APP_HOST=""
if [ -n "$DOMAIN" ]; then
  if [ "$RECORD" = @ ]; then APP_HOST=$DOMAIN; else APP_HOST="$RECORD.$DOMAIN"; fi
fi
SITE_ADDRESS=${APP_HOST:-:80}

# Firewall rules. Each value is ONE argument holding space-separated rules.
SSH_ADDRS=""
OLD_IFS=$IFS
IFS=,
for cidr in $SSH_FROM; do SSH_ADDRS="$SSH_ADDRS,address:$cidr"; done
IFS=$OLD_IFS
ANY="address:0.0.0.0/0,address:::/0"
IN_RULES="protocol:tcp,ports:22$SSH_ADDRS protocol:tcp,ports:80,$ANY protocol:tcp,ports:443,$ANY"
OUT_RULES="protocol:tcp,ports:all,$ANY protocol:udp,ports:all,$ANY protocol:icmp,$ANY"

# ---- render the cloud-init user data into a private temp file -------------------
RENDERED=""
cleanup() { [ -n "$RENDERED" ] && rm -f "$RENDERED"; return 0; }
trap cleanup EXIT

render_user_data() {
  RENDERED=$(mktemp "${TMPDIR:-/tmp}/user-data.XXXXXX")
  chmod 600 "$RENDERED"
  python3 - "$USER_DATA" "$RENDERED" "$APP_IMAGE" "$SITE_ADDRESS" <<'PY'
import re, sys
src, dst, image, site = sys.argv[1:5]
text = open(src, encoding="utf-8").read()
text, n1 = re.subn(r"(?m)^(\s+)APP_IMAGE=.*$", lambda m: m.group(1) + "APP_IMAGE=" + image, text)
text, n2 = re.subn(r"(?m)^(\s+)SITE_ADDRESS=.*$", lambda m: m.group(1) + "SITE_ADDRESS=" + site, text)
if n1 != 1 or n2 != 1:
    sys.exit(f"expected one APP_IMAGE= line and one SITE_ADDRESS= line in {src}, found {n1} and {n2}")
if not text.startswith("#cloud-config"):
    sys.exit(f"{src} must start with #cloud-config")
if len(text.encode()) > 64 * 1024:
    sys.exit("user data is over DigitalOcean's 64 KiB limit")
open(dst, "w", encoding="utf-8").write(text)
PY
  # User data is readable from inside the droplet and in the control panel.
  # Refuse to send it if the API token somehow ended up in it.
  if [ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] && grep -qF -f /dev/stdin "$RENDERED" <<EOF; then
$DIGITALOCEAN_ACCESS_TOKEN
EOF
    die "the user data contains your API token. Never put secrets in cloud-init."
  fi
}

# ---- SSH key: on the account AND the private half here ------------------------
local_key_for() { # local_key_for "aa:bb:..." -> prints where the private key is
  local want="MD5:$1" f got
  if ssh-add -l -E md5 2>/dev/null | awk '{print $2}' | grep -qx "$want"; then
    echo "ssh-agent"
    return 0
  fi
  for f in "$HOME"/.ssh/*; do
    case $f in *.pub | *known_hosts* | *config | *authorized_keys* | *.sock) continue ;; esac
    [ -f "$f" ] || continue
    got=$(ssh-keygen -l -E md5 -f "$f" </dev/null 2>/dev/null | awk '{print $2}') || continue
    if [ "$got" = "$want" ]; then
      # shellcheck disable=SC2088 # a label for people, not a path to expand
      echo "~/.ssh/$(basename "$f")"
      return 0
    fi
  done
  return 1
}

check_ssh_key() {
  local line count where
  say "SSH key"
  [ -n "$SSH_KEY_NAME" ] || die "set SSH_KEY_NAME (or --ssh-key): the name of an SSH key on your DigitalOcean account. List them with: doctl compute ssh-key list"
  line=$(doctl compute ssh-key list -o json | pyjson sshkey "$SSH_KEY_NAME")
  read -r count KEY_ID KEY_FP <<EOF
$line
EOF
  case $count in
    1) ;;
    0) die "no SSH key named '$SSH_KEY_NAME' on the account. Upload this machine's: doctl compute ssh-key import my-laptop --public-key-file ~/.ssh/id_ed25519.pub" ;;
    *) die "$count SSH keys are named '$SSH_KEY_NAME'. Rename one so the name is unique." ;;
  esac
  if where=$(local_key_for "$KEY_FP"); then
    ok "SSH key '$SSH_KEY_NAME' (id $KEY_ID): private half found in $where"
  else
    die "SSH key '$SSH_KEY_NAME' is on the account, but its private half is NOT on this machine (checked ~/.ssh and ssh-agent).
       A droplet made with it would be unreachable. Use a key you hold, or upload this machine's key:
         doctl compute ssh-key import my-laptop --public-key-file ~/.ssh/id_ed25519.pub"
  fi
}

# ---- look at what exists (read-only) ------------------------------------------
inspect_all() {
  inspect_droplet "$NAME"
  case $D_COUNT in
    0 | 1) ;;
    *) die "$D_COUNT droplets are named '$NAME' (DigitalOcean allows duplicate names). Pick a unique name or delete the extra one." ;;
  esac

  RIP_STATE=skip RIP="" RIP_EXTRA=""
  if [ "$RESERVED_IP" = yes ]; then
    read -r RIP_STATE RIP RIP_EXTRA <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip "$D_ID" "$REGION" "$RIP_ADDR")
EOF
    [ "$RIP" = - ] && RIP=""
    case $RIP_STATE in
      busy) die "reserved IP $RIP_ADDR is assigned to another droplet ($RIP_EXTRA). Unassign it first, or pick another." ;;
      wrong-region) die "reserved IP $RIP_ADDR is in region $RIP_EXTRA, not $REGION. Reserved IPs can't move between regions." ;;
      not-found) die "reserved IP $RIP_ADDR is not on this account." ;;
    esac
  fi

  FW_STATE="" FW_ID="" FW_BY_ID="" FW_BY_TAG="" FW_OTHERS=""
  read -r FW_STATE FW_ID FW_BY_ID FW_BY_TAG FW_OTHERS <<EOF
$(doctl compute firewall list -o json | pyjson fw "$FW_NAME" "$D_ID" "$TAG")
EOF
  [ "$FW_STATE" = dup ] && die "$FW_ID firewalls are named '$FW_NAME'. Delete the extra one first."

  REC_COUNT="" REC_ID="" REC_DATA="" ZONE=no
  if [ "$MANAGE_DNS" = yes ]; then
    if doctl compute domain get "$DOMAIN" >/dev/null 2>&1; then
      ZONE=yes
      read -r REC_COUNT REC_ID REC_DATA <<EOF
$(doctl compute domain records list "$DOMAIN" -o json | pyjson records "$RECORD")
EOF
    fi
  fi
  return 0
}

# What the droplet's address will be once everything is in place.
target_ip() {
  if [ "$RESERVED_IP" = yes ]; then echo "${RIP:-<new reserved IP>}"; else echo "${D_IP:-<droplet IP>}"; fi
}

# Print the plan from what inspect_all found. Sets CHANGES and BILLABLE.
plan_from_state() {
  CHANGES=0 BILLABLE=0
  local ip
  say "Plan for droplet '$NAME' ($SIZE, $REGION, $IMAGE)"

  if [ -n "$D_ID" ]; then
    ok "droplet exists (id $D_ID, droplet IP ${D_IP:-none yet})"
    if has_tag "$D_TAGS" "$TAG"; then ok "droplet has tag $TAG"; else todo "add tag $TAG to the droplet"; CHANGES=1; fi
  else
    todo "create the droplet with SSH key '$SSH_KEY_NAME', tag $TAG, monitoring, backups=$BACKUPS, user data from $(basename "$USER_DATA")"
    info "       app image $APP_IMAGE, Caddy site address $SITE_ADDRESS"
    CHANGES=1 BILLABLE=1
  fi

  case $RIP_STATE in
    skip) info "reserved IP: not used (RESERVED_IP=no); DNS must follow the droplet's own IP" ;;
    assigned) ok "reserved IP $RIP is assigned to the droplet" ;;
    free)
      todo "reuse unassigned reserved IP $RIP and assign it to the droplet"
      if [ "${RIP_EXTRA:-1}" != 1 ] && [ -z "$RIP_ADDR" ]; then
        warn "$RIP_EXTRA unassigned reserved IPs in $REGION. Each one bills about \$5/month until released."
      fi
      CHANGES=1
      ;;
    none) todo "create a reserved IP in $REGION and assign it (free while assigned)"; CHANGES=1 BILLABLE=1 ;;
  esac

  case $FW_STATE in
    none) todo "create firewall $FW_NAME (in: 22 from $SSH_FROM, 80, 443; out: all) for tag $TAG"; CHANGES=1 ;;
    found)
      if [ "$FW_BY_TAG" = yes ]; then
        ok "firewall $FW_NAME covers tag $TAG"
      else
        todo "attach firewall $FW_NAME to tag $TAG (it isn't, so a re-created droplet would be unprotected)"
        CHANGES=1
      fi
      if [ "$FW_BY_ID" = no ] && [ "${FW_OTHERS:-0}" != 0 ]; then
        info "       $FW_NAME also lists $FW_OTHERS other droplet ID(s), maybe from a droplet that no longer exists"
      fi
      ;;
  esac

  ip=$(target_ip)
  if [ -z "$DOMAIN" ]; then
    info "DNS: no domain set. The app will answer on http://$ip/ (Caddy serves plain HTTP on :80)"
  elif [ "$MANAGE_DNS" = no ]; then
    info "DNS: add this record where your DNS is hosted:  A  $APP_HOST  ->  $ip  (TTL 300)"
  elif [ "$ZONE" = no ]; then
    todo "create DNS zone $DOMAIN in DigitalOcean (without --ip-address, so no surprise apex record)"
    todo "create A record $APP_HOST -> $ip (TTL 300)"
    CHANGES=1
  else
    case $REC_COUNT in
      0) todo "create A record $APP_HOST -> $ip (TTL 300)"; CHANGES=1 ;;
      1)
        if [ "$REC_DATA" = "$ip" ]; then ok "A record $APP_HOST -> $ip"; else todo "update A record $APP_HOST from $REC_DATA to $ip"; CHANGES=1; fi
        ;;
      *) warn "$REC_COUNT A records exist for $APP_HOST. DNS will round-robin between them. Fix them by hand; this script won't guess." ;;
    esac
  fi

  if [ "$BILLABLE" = 1 ]; then
    local price
    price=$(doctl compute size list -o json 2>/dev/null | pyjson price "$SIZE" || echo "?")
    [ "$price" = "?" ] && price=$(approx_price "$SIZE")
    say "Cost (billed by the hour, up to these monthly amounts)"
    # shellcheck disable=SC2016 # the dollar signs are prices, not variables
    info "$(printf '%-26s about $%s/month' "droplet $SIZE" "$price")"
    if [ "$BACKUPS" = yes ]; then info "$(printf '%-26s +20%% (weekly) or +30%% (daily) of the droplet' "backups ${BACKUP_PLAN:-}")"; fi
    # shellcheck disable=SC2016
    info "$(printf '%-26s free while assigned; about $5/month if left unassigned' "reserved IP")"
    info "$(printf '%-26s free' "firewall, DNS, monitoring")"
  fi
  return 0
}

print_dry_run_plan() {
  local price
  price=$(approx_price "$SIZE")
  say "DRY RUN: no token used, no API calls, nothing created"
  info "Settings: name=$NAME region=$REGION size=$SIZE image=$IMAGE tag=$TAG"
  info "          ssh key=${SSH_KEY_NAME:-<not set: needed for a real run>} app image=$APP_IMAGE"
  info "          site address=$SITE_ADDRESS reserved ip=$RESERVED_IP manage dns=$MANAGE_DNS backups=$BACKUPS"
  info "User data: $(basename "$USER_DATA") rendered OK with APP_IMAGE and SITE_ADDRESS filled in"

  say "1. SSH key (read-only checks)"
  show_cmd 'would run:' doctl compute ssh-key list -o json
  info "then compare its fingerprint with ssh-keygen -l -E md5 on ~/.ssh/* and ssh-add -l"

  say "2. Droplet (skipped if one named $NAME exists)"
  show_cmd 'would run:' doctl compute droplet list -o json
  local args=(doctl compute droplet create "$NAME" --region "$REGION" --size "$SIZE" --image "$IMAGE"
    --ssh-keys "<ssh-key-id>" --tag-names "$TAG" --user-data-file "<rendered $(basename "$USER_DATA")>"
    --enable-monitoring --wait --format ID --no-header)
  if [ "$BACKUPS" = yes ]; then
    args+=(--enable-backups)
    if [ -n "$BACKUP_PLAN" ]; then args+=(--backup-policy-plan "$BACKUP_PLAN"); fi
  fi
  show_cmd 'would run:' "${args[@]}"

  say "3. Reserved IP"
  if [ "$RESERVED_IP" = yes ]; then
    show_cmd 'would run:' doctl compute reserved-ip list -o json
    if [ -n "$RIP_ADDR" ]; then
      show_cmd 'would run:' doctl compute reserved-ip-action assign "$RIP_ADDR" "<droplet-id>"
    else
      info "reuse an unassigned one in $REGION if there is one:"
      show_cmd 'would run:' doctl compute reserved-ip-action assign "<free-ip>" "<droplet-id>"
      info "otherwise create one:"
      show_cmd 'would run:' doctl compute reserved-ip create --droplet-id "<droplet-id>" --format IP --no-header
    fi
  else
    info "skipped (RESERVED_IP=no)"
  fi

  say "4. Firewall (attached by tag, then checked)"
  show_cmd 'would run:' doctl compute firewall list -o json
  show_cmd 'would run:' doctl compute firewall create --name "$FW_NAME" --tag-names "$TAG" \
    --inbound-rules "$IN_RULES" --outbound-rules "$OUT_RULES"
  info "or, if $FW_NAME exists but doesn't cover tag $TAG:"
  show_cmd 'would run:' doctl compute firewall add-tags "<firewall-id>" --tag-names "$TAG"

  say "5. DNS"
  if [ -z "$DOMAIN" ]; then
    info "no domain: the app answers on http://<ip>/"
  elif [ "$MANAGE_DNS" = yes ]; then
    show_cmd 'would run:' doctl compute domain get "$DOMAIN"
    show_cmd 'would run:' doctl compute domain create "$DOMAIN"
    show_cmd 'would run:' doctl compute domain records create "$DOMAIN" --record-type A --record-name "$RECORD" \
      --record-data "<ip>" --record-ttl 300
    info "(or records update --record-id <id> if the A record exists with another address)"
  else
    info "you add:  A  $APP_HOST  ->  <ip>  (TTL 300) where your DNS is hosted"
  fi

  say "Cost if everything is created"
  info "droplet $SIZE about \$$price/month (dry-run estimate; a real run asks the API), backups +20-30%"
  info "reserved IP free while assigned (about \$5/month if left unassigned); firewall and DNS free"
}

# ---- apply -------------------------------------------------------------------
apply_droplet() {
  if [ -z "$D_ID" ]; then
    say "Creating droplet $NAME (takes a minute or two)"
    local args=(compute droplet create "$NAME" --region "$REGION" --size "$SIZE" --image "$IMAGE"
      --ssh-keys "$KEY_ID" --tag-names "$TAG" --user-data-file "$RENDERED"
      --enable-monitoring --wait --format ID --no-header)
    if [ "$BACKUPS" = yes ]; then
      args+=(--enable-backups)
      if [ -n "$BACKUP_PLAN" ]; then args+=(--backup-policy-plan "$BACKUP_PLAN"); fi
    fi
    run doctl "${args[@]}" >/dev/null
    CREATED_DROPLET=1
    inspect_droplet "$NAME"
    [ -n "$D_ID" ] || die "droplet create returned, but no droplet named $NAME was found"
    ok "created droplet $D_ID"
  fi
  if ! has_tag "$D_TAGS" "$TAG"; then
    run doctl compute droplet tag "$D_ID" --tag-name "$TAG" >/dev/null
    D_TAGS="${D_TAGS:+$D_TAGS,}$TAG"
  fi
}

wait_rip_assigned() {
  local state ip
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    read -r state ip _ <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip "$D_ID" "$REGION" "")
EOF
    if [ "$state" = assigned ]; then RIP=$ip; return 0; fi
    sleep 5
  done
  die "reserved IP didn't show as assigned after a minute. Check: doctl compute reserved-ip list"
}

apply_rip() {
  [ "$RESERVED_IP" = yes ] || return 0
  # Re-read: a new droplet changes the picture.
  read -r RIP_STATE RIP RIP_EXTRA <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip "$D_ID" "$REGION" "$RIP_ADDR")
EOF
  [ "$RIP" = - ] && RIP=""
  case $RIP_STATE in
    assigned) return 0 ;;
    free)
      say "Assigning reserved IP $RIP"
      run doctl compute reserved-ip-action assign "$RIP" "$D_ID" >/dev/null
      ;;
    none)
      say "Creating a reserved IP"
      run doctl compute reserved-ip create --droplet-id "$D_ID" --format IP --no-header >/dev/null
      ;;
    *) die "reserved IP problem ($RIP_STATE). Run with --check for details." ;;
  esac
  wait_rip_assigned
  ok "reserved IP $RIP is assigned"
}

apply_firewall() {
  read -r FW_STATE FW_ID FW_BY_ID FW_BY_TAG FW_OTHERS <<EOF
$(doctl compute firewall list -o json | pyjson fw "$FW_NAME" "$D_ID" "$TAG")
EOF
  case $FW_STATE in
    none)
      say "Creating firewall $FW_NAME"
      run doctl compute firewall create --name "$FW_NAME" --tag-names "$TAG" \
        --inbound-rules "$IN_RULES" --outbound-rules "$OUT_RULES" --format ID --no-header >/dev/null
      ;;
    found)
      if [ "$FW_BY_TAG" != yes ]; then
        say "Attaching firewall $FW_NAME to tag $TAG"
        run doctl compute firewall add-tags "$FW_ID" --tag-names "$TAG" >/dev/null
      fi
      ;;
    *) die "firewall problem ($FW_STATE)" ;;
  esac
  # Assert the relationship, not just that a firewall exists.
  read -r FW_STATE FW_ID FW_BY_ID FW_BY_TAG FW_OTHERS <<EOF
$(doctl compute firewall list -o json | pyjson fw "$FW_NAME" "$D_ID" "$TAG")
EOF
  if [ "$FW_BY_TAG" = yes ] && has_tag "$D_TAGS" "$TAG"; then
    ok "firewall $FW_NAME covers droplet $D_ID (via tag $TAG)"
  else
    die "firewall $FW_NAME does NOT cover droplet $D_ID. Check it in the control panel before going on."
  fi
}

apply_dns() {
  [ -n "$DOMAIN" ] || return 0
  local ip
  ip=$(target_ip)
  if [ "$MANAGE_DNS" = no ]; then
    info "Add this DNS record where your DNS is hosted:  A  $APP_HOST  ->  $ip  (TTL 300)"
    return 0
  fi
  say "DNS for $APP_HOST"
  if ! doctl compute domain get "$DOMAIN" >/dev/null 2>&1; then
    # No --ip-address on purpose: with it, DigitalOcean also creates an apex A
    # record, and adding our own record for @ would make a duplicate.
    run doctl compute domain create "$DOMAIN" >/dev/null
  fi
  read -r REC_COUNT REC_ID REC_DATA <<EOF
$(doctl compute domain records list "$DOMAIN" -o json | pyjson records "$RECORD")
EOF
  case $REC_COUNT in
    0) run doctl compute domain records create "$DOMAIN" --record-type A --record-name "$RECORD" \
         --record-data "$ip" --record-ttl 300 >/dev/null ;;
    1)
      if [ "$REC_DATA" != "$ip" ]; then
        run doctl compute domain records update "$DOMAIN" --record-id "$REC_ID" --record-type A \
          --record-data "$ip" >/dev/null
      fi
      ;;
    *) warn "$REC_COUNT A records for $APP_HOST: left alone. Fix by hand." ;;
  esac
  ok "A $APP_HOST -> $ip"
  if dig_ns_is_do "$DOMAIN"; then
    ok "$DOMAIN is delegated to DigitalOcean's nameservers"
  else
    warn "$DOMAIN doesn't look delegated to ns1/ns2/ns3.digitalocean.com, so these records may not be what the world sees."
  fi
}

# ---- --check: read-only report -------------------------------------------------
run_check() {
  local fails=0 ip seen
  say "Checking droplet '$NAME' (read-only)"
  check_ssh_key
  inspect_all
  if [ -n "$D_ID" ]; then ok "droplet $D_ID exists, droplet IP ${D_IP:-none}"; else warn "no droplet named $NAME"; fails=1; fi
  if [ -n "$D_ID" ]; then
    if has_tag "$D_TAGS" "$TAG"; then ok "droplet has tag $TAG"; else warn "droplet lacks tag $TAG"; fails=1; fi
  fi
  case $RIP_STATE in
    skip) ;;
    assigned) ok "reserved IP $RIP assigned" ;;
    *) warn "no reserved IP assigned to the droplet ($RIP_STATE ${RIP:-})"; fails=1 ;;
  esac
  if [ "$FW_STATE" = found ] && [ "$FW_BY_TAG" = yes ] && has_tag "$D_TAGS" "$TAG"; then
    ok "firewall $FW_NAME covers the droplet via tag $TAG"
  elif [ "$FW_STATE" = found ] && [ "$FW_BY_ID" = yes ]; then
    ok "firewall $FW_NAME covers the droplet by ID (re-run without --check to attach it by tag too)"
  else
    warn "firewall $FW_NAME does not cover the droplet"
    fails=1
  fi
  ip=$(target_ip)
  if [ -n "$APP_HOST" ]; then
    seen=$(dig_a "$APP_HOST")
    if [ -z "$seen" ]; then
      warn "public DNS has no A record for $APP_HOST yet (or dig isn't installed)"
      fails=1
    elif [ "$seen" = "$ip" ]; then
      ok "public DNS: $APP_HOST -> $seen"
    else
      warn "public DNS: $APP_HOST -> $seen, expected $ip"
      fails=1
    fi
  fi
  [ -n "$D_ID" ] && printf 'droplet_id=%s\nip=%s\n' "$D_ID" "$ip"
  if [ "$fails" = 0 ]; then say "All in place."; else say "Something needs attention (see WARN lines)."; fi
  return $fails
}

# ---- main --------------------------------------------------------------------
CREATED_DROPLET=0
require_cmd python3

if [ "$DRY_RUN" = 1 ]; then
  render_user_data # local only: proves the template renders
  print_dry_run_plan
  printf 'droplet_id=%s\nip=%s\n' "DRY-RUN" "203.0.113.10"
  info ""
  info "(Those two lines are placeholders. Nothing was created.)"
  exit 0
fi

require_cmd doctl ssh-keygen
load_token
render_user_data # after the token is loaded, so the "token in user data" check runs

if [ "$CHECK" = 1 ]; then
  run_check
  exit $?
fi

check_ssh_key
inspect_all
plan_from_state

if [ "$CHANGES" = 0 ]; then
  say "Nothing to change."
else
  if [ "$BILLABLE" = 1 ]; then
    confirm "This creates resources that cost money. Go ahead?"
  else
    confirm "Apply these changes?"
  fi
  apply_droplet
  apply_rip
  apply_firewall
  apply_dns
fi

IP=$(target_ip)
say "Done"
info "Next:"
info "  1. Wait for first boot (3-6 minutes):   ssh app@$IP cloud-init status --wait"
info "     For the first few minutes 'Connection refused' or 'Permission denied (publickey)' is normal:"
info "     package updates run first, then user app gets your keys and sshd restarts. Retry; don't touch keys."
if [ -n "$APP_HOST" ]; then
  info "  2. Check from outside:  scripts/do/check-health.sh https://$APP_HOST/health --wait 600"
else
  info "  2. Check from outside:  scripts/do/check-health.sh http://$IP/health --wait 600"
fi
if [ "$CREATED_DROPLET" = 1 ] && [ "$RESERVED_IP" = yes ]; then
  info "  If you had a droplet on this IP before, SSH will warn that the host key changed."
  info "  Only because you re-created it yourself:  ssh-keygen -R $IP"
fi
printf 'droplet_id=%s\nip=%s\n' "$D_ID" "$IP"
