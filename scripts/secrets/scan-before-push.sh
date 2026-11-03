#!/usr/bin/env bash
# scan-before-push.sh: look for secrets and private details before they leave
# your machine. Prints WHERE (file:line) and WHAT KIND, never the value itself.
#
#   scripts/secrets/scan-before-push.sh                         scan the current repo
#   scripts/secrets/scan-before-push.sh --env-file secrets/do.env --env-file secrets/portainer.env \
#       --denylist secrets/denylist.txt
#   scripts/secrets/scan-before-push.sh --history ...           also every commit in the history
#
# What it looks for:
#   key-shaped     strings shaped like real keys: private key blocks, GitHub, DigitalOcean,
#                  AWS, Slack, Stripe, Google, OpenAI/Anthropic, Portainer tokens, JWTs,
#                  passwords inside URLs, and long values assigned to *_KEY/*SECRET/*TOKEN/*PASSWORD
#   private-ip     10.x, 172.16-31.x, 192.168.x and 100.64-127.x (CGNAT/VPN) addresses
#   email          email addresses (example.com and noreply addresses are skipped)
#   secret-file    files that shouldn't be committed: .env files, private keys, keystores,
#                  service-account JSON, and any --env-file that isn't gitignored
#   env-value      ANY value from the env files you pass (8+ characters), wherever it
#                  appears: your real hostnames, tokens and passwords, in any form
#   denylist       any line of your --denylist file (case-insensitive): names of people,
#                  companies, places, hosts. Keep that file in secrets/ too.
#
# Which files: in a git repo, every file git would commit (tracked files plus new
# files that aren't ignored). Elsewhere, every file except .git, node_modules,
# dist, build and virtualenvs. --all-files ignores .gitignore.
#
# Options:
#   --env-file FILE   repeatable; values shorter than --min-length (default 8) are skipped
#   --denylist FILE   one term per line, # comments allowed
#   --history         also scan every commit reachable from any branch or tag (git only)
#   --all-files       scan ignored files too (still skips .git and node_modules)
#   --min-length N    shortest env value to look for (default 8)
#   --ignore-key KEY  repeatable; don't look for this env key's value (a harmless setting)
#                     Skipped by default: SIZE IMAGE NODE_ENV KEYCHAIN_SERVICE
#                     COMPOSE_PROJECT_NAME, plain numbers, and words like production/localhost.
#
# A line containing "scan:allow" is skipped for every category except env-value.
# Exit 0 = nothing found, 1 = findings, 2 = bad arguments.
#
# As a git pre-push hook (hooks are per clone, so each clone installs it). It
# passes only the files that exist in this clone, so a clone without them can
# still push (a missing --env-file is an error, exit 2):
#   cat > .git/hooks/pre-push <<'HOOK'
#   #!/bin/sh
#   set --
#   for f in secrets/*.env; do [ -f "$f" ] && set -- "$@" --env-file "$f"; done
#   [ -f secrets/denylist.txt ] && set -- "$@" --denylist secrets/denylist.txt
#   exec scripts/secrets/scan-before-push.sh "$@"
#   HOOK
#   chmod +x .git/hooks/pre-push
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }

DIR="" DENYLIST="" HISTORY=0 ALL_FILES=0 MIN_LEN=8
ENV_FILES=()
IGNORE_KEYS=" SIZE IMAGE NODE_ENV KEYCHAIN_SERVICE COMPOSE_PROJECT_NAME "
while [ $# -gt 0 ]; do
  case $1 in
    --env-file) [ $# -ge 2 ] || die "$1 needs a value"; ENV_FILES+=("$2"); shift ;;
    --denylist) [ $# -ge 2 ] || die "$1 needs a value"; DENYLIST=$2; shift ;;
    --history) HISTORY=1 ;;
    --all-files) ALL_FILES=1 ;;
    --min-length) [ $# -ge 2 ] || die "$1 needs a value"; MIN_LEN=$2; shift ;;
    --ignore-key) [ $# -ge 2 ] || die "$1 needs a value"; IGNORE_KEYS="$IGNORE_KEYS$2 "; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) [ -z "$DIR" ] || die "only one folder, please"; DIR=$1 ;;
  esac
  shift
done
case $MIN_LEN in '' | *[!0-9]*) die "--min-length takes a number" ;; esac
DIR=${DIR:-.}
[ -d "$DIR" ] || die "not a folder: $DIR"

abspath() { (cd "$(dirname "$1")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")"); }

ENV_ABS=()
for ef in ${ENV_FILES[@]+"${ENV_FILES[@]}"}; do
  [ -f "$ef" ] || die "env file not found: $ef"
  ENV_ABS+=("$(abspath "$ef")")
done
DENY_ABS=""
if [ -n "$DENYLIST" ]; then
  [ -f "$DENYLIST" ] || die "denylist not found: $DENYLIST"
  DENY_ABS=$(abspath "$DENYLIST")
fi

ROOT=$(cd "$DIR" && pwd -P)
cd "$ROOT"
IS_GIT=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then IS_GIT=1; fi
if [ "$HISTORY" = 1 ] && [ "$IS_GIT" = 0 ]; then die "--history needs a git repository"; fi

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/scan.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
TAB=$(printf '\t')
: >"$WORK/findings"
: >"$WORK/findings.history"

# History hits ("@abc1234:12") go to their own file and get their own section.
add_finding() {
  case $2 in
    @*) printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$WORK/findings.history" ;;
    *) printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$WORK/findings" ;;
  esac
}

is_excluded() { # the env files and denylist themselves are not scanned
  local abs="$ROOT/$1" e
  [ -n "$DENY_ABS" ] && [ "$abs" = "$DENY_ABS" ] && return 0
  for e in ${ENV_ABS[@]+"${ENV_ABS[@]}"}; do [ "$abs" = "$e" ] && return 0; done
  return 1
}

# ---- 1. the list of files --------------------------------------------------------
if [ "$IS_GIT" = 1 ] && [ "$ALL_FILES" = 0 ]; then
  git ls-files -z --cached --others --exclude-standard >"$WORK/files.raw"
else
  find . \( -name .git -o -name node_modules -o -name dist -o -name build -o -name .venv \
    -o -name venv -o -name __pycache__ -o -name .next -o -name coverage \) -prune \
    -o -type f -print0 >"$WORK/files.raw"
fi
while IFS= read -r -d '' f; do
  f=${f#./}
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  if is_excluded "$f"; then continue; fi
  printf '%s\0' "$f"
done <"$WORK/files.raw" >"$WORK/files"
NFILES=$(tr -cd '\0' <"$WORK/files" | wc -c | tr -d ' ')
[ "$NFILES" -gt 0 ] || { echo "No files to scan in $ROOT."; exit 0; }

# ---- helpers ------------------------------------------------------------------------
shopt -s nocasematch

is_placeholder() {
  # shellcheck disable=SC2016 # a literal ${ is what we look for
  case $1 in
    *your-* | *your_* | *example* | *'<'* | *'${'* | *change-me* | *changeme* | *xxxx* | *'...'* | \
      *placeholder* | *dummy* | *fake* | *redacted* | *sample* | *'****'* | *not-a-real* | \
      *not_a_real* | *0000000000*) return 0 ;;
  esac
  return 1
}

# search tree|history GREP-ARGS... -> "path<TAB>where<TAB>content" lines
search() {
  local mode=$1 hit path rest rev
  shift
  if [ "$mode" = tree ]; then
    xargs -0 grep -n -I -H "$@" -- <"$WORK/files" 2>/dev/null | while IFS= read -r hit; do
      path=${hit%%:*}
      rest=${hit#*:}
      printf '%s\t%s\t%s\n' "$path" "${rest%%:*}" "${rest#*:}"
    done || true
  else
    git rev-list --all | xargs git grep -n -I "$@" 2>/dev/null | while IFS= read -r hit; do
      rev=${hit%%:*}
      rest=${hit#*:}
      path=${rest%%:*}
      rest=${rest#*:}
      printf '%s\t@%s:%s\t%s\n' "$path" "${rev:0:7}" "${rest%%:*}" "${rest#*:}"
    done || true
  fi
}

is_benign_email() {
  case $1 in
    *noreply* | git@* | *@localhost* | *@example.* | *.example | *@your-domain*) return 0 ;;
  esac
  is_placeholder "$1"
}

# Does this line hold at least one match that isn't a placeholder? Each match is
# judged on its own, so a "noreply@example.com" can't hide a real address next to it.
has_real_match() { # has_real_match FILTER FLAGS REGEX CONTENT
  local filter=$1 flags=$2 re=$3 m
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    if [ "$filter" = email ]; then
      is_benign_email "$m" || return 0
    else
      is_placeholder "$m" || return 0
    fi
  done <<EOF
$(printf '%s\n' "$4" | grep -o "$flags" -e "$re" 2>/dev/null)
EOF
  return 1
}

# record CATEGORY DETAIL FILTER FLAGS REGEX < search output   (FILTER: none|placeholder|email)
record() {
  local cat=$1 detail=$2 filter=$3 flags=${4:-} re=${5:-} path where content
  while IFS="$TAB" read -r path where content; do
    if [ "$cat" != env-value ]; then
      case $content in *scan:allow*) continue ;; esac
    fi
    if [ "$filter" != none ] && ! has_real_match "$filter" "$flags" "$re" "$content"; then
      continue
    fi
    add_finding "$path" "$where" "$cat" "$detail"
  done
}

MODES=(tree)
if [ "$HISTORY" = 1 ]; then MODES+=(history); fi

pattern() { # pattern CATEGORY DETAIL FILTER FLAGS REGEX
  local m
  for m in "${MODES[@]}"; do search "$m" "$4" -e "$5" | record "$1" "$2" "$3" "$4" "$5"; done
}

# ---- 2. key-shaped strings -------------------------------------------------------------
pattern key-shaped "private key block" none -E '-----BEGIN[ A-Z]*PRIVATE KEY( BLOCK)?-----'
pattern key-shaped "GitHub token" none -E 'gh[pousr]_[A-Za-z0-9]{36,}'
pattern key-shaped "GitHub fine-grained token" none -E 'github_pat_[A-Za-z0-9_]{50,}'
pattern key-shaped "DigitalOcean token" none -E 'do[opr]_v1_[a-f0-9]{64}'
pattern key-shaped "AWS access key id" none -E '(^|[^A-Z0-9])(AKIA|ASIA)[0-9A-Z]{16}([^A-Z0-9]|$)'
pattern key-shaped "Slack token" none -E 'xox[abprs]-[A-Za-z0-9-]{10,}'
pattern key-shaped "Stripe live key" none -E '[rs]k_live_[A-Za-z0-9]{20,}'
pattern key-shaped "Google API key" none -E 'AIza[0-9A-Za-z_-]{35}'
pattern key-shaped "Anthropic/OpenAI-style key" none -E 'sk-(ant-|proj-)?[A-Za-z0-9_-]{32,}'
pattern key-shaped "Portainer access token" none -E 'ptr_[A-Za-z0-9+/=_-]{30,}'
pattern key-shaped "JWT" none -E 'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
pattern key-shaped "password inside a URL" placeholder -E '[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]+@'
pattern key-shaped "long value assigned to a key/secret/token/password name" placeholder -Ei \
  '(api[_-]?key|secret|token|passw(or)?d|access[_-]?key)[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9/+_=.-]{20,}'

# ---- 3. private addresses and emails ---------------------------------------------------
pattern private-ip "private IP (10.x)" none -E '(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)'
pattern private-ip "private IP (172.16-31.x)" none -E '(^|[^0-9.])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)'
pattern private-ip "private IP (192.168.x)" none -E '(^|[^0-9.])192\.168\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)'
pattern private-ip "CGNAT/VPN IP (100.64-127.x)" none -E '(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)'
pattern email "email address" email -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'

# ---- 4. files that shouldn't be committed ---------------------------------------------------
while IFS= read -r -d '' f; do
  base=${f##*/}
  case $base in
    *.example | *.sample | *.template | *.dist) ;;
    .env | *.env | .env.*) add_finding "$f" - secret-file "an env file that would be committed" ;;
    id_rsa | id_dsa | id_ecdsa | id_ed25519 | *.pem | *.key | *.p12 | *.pfx | *.jks | *.keystore | *.kdbx | \
      *service-account*.json | credentials.json)
      add_finding "$f" - secret-file "a key or credential file that would be committed" ;;
  esac
done <"$WORK/files"

for i in ${ENV_ABS[@]+"${!ENV_ABS[@]}"}; do
  abs=${ENV_ABS[$i]}
  case $abs in
    "$ROOT"/*)
      rel=${abs#"$ROOT"/}
      if [ "$IS_GIT" = 1 ]; then
        git check-ignore -q "$rel" || add_finding "$rel" - secret-file "this env file is NOT gitignored"
      else
        add_finding "$rel" - secret-file "this env file is inside the folder being scanned; make sure it's ignored"
      fi
      ;;
  esac
done

# ---- 5. values from your env files ------------------------------------------------------------
shopt -u nocasematch
n=0 SKIPPED=""
for i in ${ENV_ABS[@]+"${!ENV_ABS[@]}"}; do
  ef=${ENV_FILES[$i]}
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    case $line in '' | '#'*) continue ;; esac
    case $line in 'export '*) line=${line#export}; line=${line#"${line%%[![:space:]]*}"} ;; esac
    case $line in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    key=${key%"${key##*[![:space:]]}"}
    val=${line#*=}
    val=${val#"${val%%[![:space:]]*}"}
    case $val in
      \"*) val=${val#\"}; val=${val%%\"*} ;;
      \'*) val=${val#\'}; val=${val%%\'*} ;;
      *) val=${val%%[[:space:]]#*}; val=${val%"${val##*[![:space:]]}"} ;;
    esac
    [ "${#val}" -ge "$MIN_LEN" ] || continue
    case $IGNORE_KEYS in
      *" $key "*)
        case "$SKIPPED " in *" $key "*) ;; *) SKIPPED="$SKIPPED $key" ;; esac
        continue
        ;;
    esac
    case $val in
      YOUR_* | your-* | change-me* | changeme* | *[!0-9]*) ;;
      *) continue ;; # plain numbers (ports, counts) are everywhere
    esac
    case $val in
      YOUR_* | your-* | change-me* | changeme* | production | development | staging | localhost | \
        unless-stopped | refs/heads/main | application/json) continue ;;
    esac
    n=$((n + 1))
    printf '%s\n' "$val" >"$WORK/v.$n"
    for m in "${MODES[@]}"; do
      search "$m" -F -f "$WORK/v.$n" | record env-value "value of $key from $ef" none
    done
    rm -f "$WORK/v.$n"
  done <"${ENV_ABS[$i]}"
done
val="" line=""
NVALUES=$n

# ---- 6. your denylist ------------------------------------------------------------------------
NDENY=0
if [ -n "$DENYLIST" ]; then
  lineno=0
  while IFS= read -r term || [ -n "$term" ]; do
    lineno=$((lineno + 1))
    term=${term%$'\r'}
    term=${term#"${term%%[![:space:]]*}"}
    term=${term%"${term##*[![:space:]]}"}
    case $term in '' | '#'*) continue ;; esac
    if [ "${#term}" -lt 3 ]; then
      printf 'note: skipping denylist line %s (shorter than 3 characters)\n' "$lineno" >&2
      continue
    fi
    NDENY=$((NDENY + 1))
    printf '%s\n' "$term" >"$WORK/d"
    for m in "${MODES[@]}"; do
      search "$m" -F -i -f "$WORK/d" | record denylist "denylist entry (line $lineno of $DENYLIST)" none
    done
  done <"$DENYLIST"
  rm -f "$WORK/d"
  term=""
fi

# ---- report ----------------------------------------------------------------------------------
scope="$NFILES files"
[ "$HISTORY" = 1 ] && scope="$scope and $(git rev-list --all | wc -l | tr -d ' ') commits"
checked="key shapes, private IPs, emails, secret files"
[ "$NVALUES" -gt 0 ] && checked="$checked, $NVALUES env value(s)"
[ "$NDENY" -gt 0 ] && checked="$checked, $NDENY denylist term(s)"
[ -n "$SKIPPED" ] && checked="$checked; not looked for:$SKIPPED"

# History: keep one line per file and finding, and only what is NOT also in
# today's files (those are listed above with line numbers). What's left was
# removed from the files but is still in old commits, for anyone who clones.
cut -f1,3,4 "$WORK/findings" | sort -u >"$WORK/tree.keys"
sort -t "$TAB" -k1,1 -k3,3 -k4,4 -u "$WORK/findings.history" | while IFS="$TAB" read -r path where cat detail; do
  if ! grep -qxF "$path$TAB$cat$TAB$detail" "$WORK/tree.keys"; then
    printf '%s\t%s\t%s\t%s\n' "$path" "$where" "$cat" "$detail"
  fi
done >"$WORK/history.only"

if [ ! -s "$WORK/findings" ] && [ ! -s "$WORK/history.only" ]; then
  echo "Clean: no findings in $scope (checked $checked)."
  exit 0
fi

print_rows() {
  local path where cat detail loc
  while IFS="$TAB" read -r path where cat detail; do
    if [ "$where" = - ]; then loc=$path; else loc="$path:$where"; fi
    printf '  %-48s %-12s %s\n' "$loc" "$cat" "$detail"
  done
}

sort -t "$TAB" -k1,1 -k2,2n -k3,3 -k4,4 "$WORK/findings" | uniq >"$WORK/sorted"
cat "$WORK/history.only" >>"$WORK/all"
cat "$WORK/sorted" >>"$WORK/all"
total=$(wc -l <"$WORK/all" | tr -d ' ')
echo "Findings in $ROOT ($scope; checked $checked):"
if [ -s "$WORK/sorted" ]; then
  echo
  print_rows <"$WORK/sorted"
fi
if [ -s "$WORK/history.only" ]; then
  echo
  echo "Only in git history (gone from the files, still in old commits; location is @commit:line):"
  print_rows <"$WORK/history.only"
fi
echo
printf '%s finding(s): ' "$total"
cut -f3 "$WORK/all" | sort | uniq -c | awk '{printf "%s%s %s", (NR>1?", ":""), $1, $2} END {print ""}'
echo "Values are never printed. Open each file:line to look. A real key that was found: revoke it, then remove it (docs/12)."
if [ -s "$WORK/history.only" ]; then
  echo "History hits stay public in every clone and fork. Revoking the key is the fix; rewriting history only tidies up."
fi
exit 1
