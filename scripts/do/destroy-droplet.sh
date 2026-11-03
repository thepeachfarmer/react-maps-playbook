#!/usr/bin/env bash
# destroy-droplet.sh: tear down what provision-droplet.sh made, so nothing keeps billing.
#
#   scripts/do/destroy-droplet.sh --dry-run          show the planned calls; no token, no API calls
#   scripts/do/destroy-droplet.sh --name maps-demo   look, list what it found, ask, then delete
#
# What it removes:
#   - the DNS A record for RECORD.DOMAIN, only if MANAGE_DNS=yes and the record
#     points at this droplet's address (it never deletes a record pointing elsewhere).
#     With MANAGE_DNS=no (the default) your DNS lives elsewhere, so it can't: it
#     prints a WARN line telling you to delete the record yourself, NOW. A record
#     left pointing at a released IP is a takeover risk: DigitalOcean can hand
#     that address to another customer, who could then serve (and get a valid
#     certificate for) your hostname.
#   - the droplet
#   - its reserved IP: released, because destroying a droplet does NOT delete
#     the reserved IP, and an unassigned one bills about $5/month (--keep-ip keeps it
#     for a rebuild)
#   - the firewall NAME-fw, unless another droplet still uses it (--keep-firewall keeps it)
#
# What it does NOT remove: snapshots, backups and volumes. It tells you how many
# snapshots the droplet has; check the control panel for the rest.
#
# You confirm by typing the droplet name. --yes skips that, for scripts, and
# only after a person has read the list and said go.
#
# Settings (flags, then environment, then the env file, default secrets/do.env):
#   --name NAME              DROPLET_NAME  (default maps-demo)
#   --tag TAG                TAG           (default: the droplet name)
#   --domain DOMAIN          DOMAIN
#   --record NAME            RECORD        (default @)
#   --manage-dns yes|no      MANAGE_DNS    (default no: leave DNS alone)
#   --reserved-ip-address IP RESERVED_IP_ADDRESS (also release this one if it's unassigned)
#   --keep-ip                keep the reserved IP on the account (it bills while unassigned)
#   --keep-firewall          keep NAME-fw
#   --env-file PATH          DO_ENV_FILE   (default secrets/do.env)
#   --keychain-service NAME  KEYCHAIN_SERVICE (look in the macOS Keychain under NAME too)
#
# stdout: one line per deleted thing (deleted_droplet_id=..., released_ip=...).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=do-common.sh
. "$SCRIPT_DIR/do-common.sh"

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

ENV_FILE=${DO_ENV_FILE:-secrets/do.env}
F_NAME="" F_TAG="" F_DOMAIN="" F_RECORD="" F_MANAGE_DNS="" F_RIP_ADDR=""
KEEP_IP=0 KEEP_FW=0

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --yes | -y) ASSUME_YES=1 ;;
    --keep-ip) KEEP_IP=1 ;;
    --keep-firewall) KEEP_FW=1 ;;
    --env-file) need_arg "$1" $#; ENV_FILE=$2; shift ;;
    --keychain-service) need_arg "$1" $#; KEYCHAIN_SERVICE=$2; export KEYCHAIN_SERVICE; shift ;;
    --name) need_arg "$1" $#; F_NAME=$2; shift ;;
    --tag) need_arg "$1" $#; F_TAG=$2; shift ;;
    --domain) need_arg "$1" $#; F_DOMAIN=$2; shift ;;
    --record) need_arg "$1" $#; F_RECORD=$2; shift ;;
    --manage-dns) need_arg "$1" $#; F_MANAGE_DNS=$2; shift ;;
    --reserved-ip-address) need_arg "$1" $#; F_RIP_ADDR=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

load_env --file "$ENV_FILE" --optional DROPLET_NAME TAG DOMAIN RECORD MANAGE_DNS \
  RESERVED_IP_ADDRESS KEYCHAIN_SERVICE

NAME=${F_NAME:-${DROPLET_NAME:-maps-demo}}
TAG=${F_TAG:-${TAG:-$NAME}}
DOMAIN=${F_DOMAIN:-${DOMAIN:-}}
RECORD=${F_RECORD:-${RECORD:-@}}
MANAGE_DNS=${F_MANAGE_DNS:-${MANAGE_DNS:-no}}
RIP_ADDR=${F_RIP_ADDR:-${RESERVED_IP_ADDRESS:-}}
FW_NAME="$NAME-fw"

case $NAME in '' | *[!a-z0-9.-]* | [.-]*) die "droplet name looks wrong: $NAME" ;; esac
case $TAG in '' | *[!A-Za-z0-9:_-]*) die "tag looks wrong: $TAG" ;; esac
case $DOMAIN in *[!A-Za-z0-9.-]*) die "domain looks wrong: $DOMAIN" ;; esac
case $RECORD in '@') ;; '' | *[!A-Za-z0-9.-]*) die "record should be a name like maps, or @" ;; esac
case $RIP_ADDR in *[!0-9.]*) die "reserved IP address should look like 203.0.113.10" ;; esac
is_yes_no "$MANAGE_DNS" || die "MANAGE_DNS must be yes or no"
if [ "$RECORD" = @ ]; then APP_HOST=$DOMAIN; else APP_HOST="$RECORD.$DOMAIN"; fi

# With MANAGE_DNS=no, tell the person to remove the record at their DNS host.
# dns_warning "IP IP..." (the addresses this run gives back to DigitalOcean)
dns_warning() {
  [ "$MANAGE_DNS" = yes ] && return 0
  local ips=${1# }
  [ -n "${ips// /}" ] || ips="this droplet's IP and its reserved IP"
  if [ -n "$DOMAIN" ]; then
    warn "Your DNS isn't managed here (MANAGE_DNS=no). Delete the A record for $APP_HOST at your DNS host NOW"
    warn "  (and any other name that points at: $ips)."
  else
    warn "DNS isn't managed here. If any DNS record points at $ips, delete it at your DNS host NOW."
  fi
  info "       A released IP goes back to DigitalOcean's pool. Whoever gets it next could serve pages,"
  info "       and get a valid certificate, for a hostname that still points at it."
}

# Ask for the droplet name to be typed back. A y/N is too easy to hit by habit.
confirm_typed() {
  local answer
  if [ "$ASSUME_YES" = 1 ]; then
    info "--yes given: deleting without the typed confirmation"
    return 0
  fi
  [ -t 0 ] || die "no terminal to ask on. Re-run with --yes only after a person has read the list above and said go."
  printf '\nThis cannot be undone. Type the droplet name (%s) to delete: ' "$NAME" >&2
  read -r answer || answer=
  [ "$answer" = "$NAME" ] || die "that didn't match. Nothing was deleted."
}

if [ "$DRY_RUN" = 1 ]; then
  say "DRY RUN: no token used, no API calls, nothing deleted"
  info "name=$NAME tag=$TAG firewall=$FW_NAME manage dns=$MANAGE_DNS keep ip=$KEEP_IP keep firewall=$KEEP_FW"
  say "1. Look (read-only)"
  show_cmd 'would run:' doctl compute droplet list -o json
  show_cmd 'would run:' doctl compute reserved-ip list -o json
  show_cmd 'would run:' doctl compute firewall list -o json
  show_cmd 'would run:' doctl compute droplet list --tag-name "$TAG" -o json
  show_cmd 'would run:' doctl compute snapshot list --resource droplet -o json
  if [ "$MANAGE_DNS" = yes ] && [ -n "$DOMAIN" ]; then
    show_cmd 'would run:' doctl compute domain records list "$DOMAIN" -o json
  fi
  say "2. Ask you to type '$NAME', then delete"
  if [ "$MANAGE_DNS" = yes ] && [ -n "$DOMAIN" ]; then
    show_cmd 'would run:' doctl compute domain records delete "$DOMAIN" "<record-id>" --force
    info "(only A records for $APP_HOST that point at this droplet's IPs)"
  fi
  show_cmd 'would run:' doctl compute droplet delete "<droplet-id>" --force
  if [ "$KEEP_IP" = 1 ]; then
    info "reserved IP kept (--keep-ip). It bills about \$5/month while unassigned."
  else
    show_cmd 'would run:' doctl compute reserved-ip delete "${RIP_ADDR:-<reserved-ip>}" --force
  fi
  if [ "$KEEP_FW" = 1 ]; then
    info "firewall kept (--keep-firewall)"
  else
    show_cmd 'would run:' doctl compute firewall delete "<firewall-id>" --force
    info "(skipped if another droplet still uses $FW_NAME)"
  fi
  if [ "$KEEP_IP" = 1 ]; then
    dns_warning "<this droplet's own IP>"
  else
    dns_warning "<this droplet's IP> ${RIP_ADDR:-<its reserved IP>}"
  fi
  exit 0
fi

require_cmd doctl python3
load_token

# ---- look ----------------------------------------------------------------------
say "Looking for '$NAME' and what belongs to it"
inspect_droplet "$NAME"
case $D_COUNT in
  0) info "no droplet named $NAME" ;;
  1) info "droplet $D_ID (IP ${D_IP:-none})" ;;
  *) die "$D_COUNT droplets are named $NAME. Delete by hand in the control panel; this script won't guess." ;;
esac

RIPS=""
if [ -n "$D_ID" ]; then
  read -r n rest <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip-of "$D_ID")
EOF
  if [ "$n" != 0 ]; then RIPS=$rest; fi
fi
if [ -n "$RIP_ADDR" ]; then
  read -r state owner <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip-get "$RIP_ADDR")
EOF
  [ "$state" = found ] || die "reserved IP $RIP_ADDR is not on this account"
  if [ "$owner" != - ] && [ "$owner" != "$D_ID" ]; then
    die "reserved IP $RIP_ADDR is assigned to another droplet ($owner). Not touching it."
  fi
  case " $RIPS " in *" $RIP_ADDR "*) ;; *) RIPS="${RIPS:+$RIPS }$RIP_ADDR" ;; esac
fi

ALIVE=$(doctl compute droplet list -o json | pyjson ids)
[ "$ALIVE" = - ] && ALIVE=""
read -r FW_STATE FW_ID _ FW_BY_TAG FW_OTHERS <<EOF
$(doctl compute firewall list -o json | pyjson fw "$FW_NAME" "$D_ID" "$TAG" "$ALIVE")
EOF
FW_DELETE=0
if [ "$FW_STATE" = found ] && [ "$KEEP_FW" = 0 ]; then
  read -r tagged <<EOF
$(doctl compute droplet list --tag-name "$TAG" -o json | pyjson count)
EOF
  if [ -n "$D_ID" ] && has_tag "$D_TAGS" "$TAG"; then tagged=$((tagged - 1)); fi
  if [ "${FW_OTHERS:-0}" != 0 ] || { [ "$FW_BY_TAG" = yes ] && [ "$tagged" -gt 0 ]; }; then
    warn "firewall $FW_NAME also covers other droplets ($FW_OTHERS by ID, $tagged by tag): keeping it"
  else
    FW_DELETE=1
  fi
fi

# DNS records to delete: those pointing at this droplet's addresses. With
# --keep-ip (a rebuild), a record pointing at the kept reserved IP stays, so
# the next droplet on that IP needs no DNS change.
DNS_IPS=$D_IP
if [ "$KEEP_IP" = 0 ]; then DNS_IPS="$DNS_IPS $RIPS"; fi
REC_IDS=""
if [ "$MANAGE_DNS" = yes ] && [ -n "$DOMAIN" ] && [ -n "${DNS_IPS// /}" ]; then
  # shellcheck disable=SC2086
  read -r n rest <<EOF
$(doctl compute domain records list "$DOMAIN" -o json | pyjson records-matching "$RECORD" $DNS_IPS)
EOF
  if [ "$n" != 0 ]; then REC_IDS=$rest; fi
fi

SNAPS=0 SNAP_GB=0
if [ -n "$D_ID" ]; then
  read -r SNAPS SNAP_GB <<EOF
$(doctl compute snapshot list --resource droplet -o json 2>/dev/null | pyjson snapshots "$D_ID" || echo "0 0")
EOF
fi

# ---- the list ----------------------------------------------------------------------
say "Will delete"
FOUND=0
for id in $REC_IDS; do info "DNS A record $APP_HOST (record id $id)"; FOUND=1; done
if [ -n "$D_ID" ]; then info "droplet $NAME (id $D_ID)"; FOUND=1; fi
if [ "$KEEP_IP" = 0 ]; then
  for ip in $RIPS; do info "reserved IP $ip (released from the account)"; FOUND=1; done
elif [ -n "$RIPS" ]; then
  info "keeping reserved IP(s): $RIPS (about \$5/month each while unassigned)"
fi
if [ "$FW_DELETE" = 1 ]; then info "firewall $FW_NAME (id $FW_ID)"; FOUND=1; fi
if [ "$FOUND" = 0 ]; then
  say "Nothing to delete."
  exit 0
fi
dns_warning "$DNS_IPS"
if [ "$SNAPS" != 0 ]; then
  warn "the droplet has $SNAPS snapshot(s), $SNAP_GB GB. They are NOT deleted and keep billing until you delete them."
fi

confirm_typed

# ---- delete ------------------------------------------------------------------------
for id in $REC_IDS; do
  run doctl compute domain records delete "$DOMAIN" "$id" --force >/dev/null
done

if [ -n "$D_ID" ]; then
  DEL_ID=$D_ID
  say "Deleting droplet $DEL_ID"
  run doctl compute droplet delete "$DEL_ID" --force >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    inspect_droplet "$NAME"
    if [ -z "$D_ID" ]; then break; fi
    sleep 5
  done
  if [ -n "$D_ID" ]; then warn "the droplet still shows up; DigitalOcean may need another minute"; fi
  printf 'deleted_droplet_id=%s\n' "$DEL_ID"
fi

if [ "$KEEP_IP" = 0 ]; then
  for ip in $RIPS; do
    say "Releasing reserved IP $ip"
    released=0
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      read -r state owner <<EOF
$(doctl compute reserved-ip list -o json | pyjson rip-get "$ip")
EOF
      if [ "$state" = not-found ]; then released=1; break; fi
      if [ "$owner" = - ]; then
        if run doctl compute reserved-ip delete "$ip" --force >/dev/null; then released=1; break; fi
      fi
      sleep 5
    done
    if [ "$released" = 1 ]; then
      printf 'released_ip=%s\n' "$ip"
    else
      warn "couldn't release $ip yet. Run this script again in a minute, or: doctl compute reserved-ip delete $ip"
    fi
  done
fi

if [ "$FW_DELETE" = 1 ]; then
  run doctl compute firewall delete "$FW_ID" --force >/dev/null
  printf 'deleted_firewall_id=%s\n' "$FW_ID"
fi

say "Done"
dns_warning "$DNS_IPS"
info "Billing for what was deleted stops within the hour. Still worth a look in the control panel:"
info "  Images > Snapshots and Backups, Volumes, Networking > Reserved IPs and Domains."
info "Done with the API token too? Revoke it (API > Tokens) or let it expire."
