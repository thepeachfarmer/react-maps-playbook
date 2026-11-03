#!/usr/bin/env bash
# load-env.sh: load named keys from a .env file or the macOS Keychain, without
# ever printing them.
#
# Use it from another script (source it, then call load_env):
#
#   . "$(dirname "$0")/../lib/load-env.sh"
#   load_env --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN || exit 1
#   load_env --file secrets/do.env --optional REGION SIZE
#
# Or run it directly to check which keys can be found (names only, never values):
#
#   scripts/lib/load-env.sh --check --file secrets/do.env DIGITALOCEAN_ACCESS_TOKEN
#
# Where each key comes from, first match wins:
#   1. the environment, if the variable is already set and not empty (CI secrets land here)
#   2. the --file env file (KEY=value lines; the file is read as data, never executed)
#   3. the macOS Keychain, if --service NAME (alias --keychain-service NAME, or
#      $KEYCHAIN_SERVICE) is given:
#        security find-generic-password -s NAME -a KEY -w
#      Store a key there with (it prompts for the value, so it never touches shell history):
#        security add-generic-password -U -s NAME -a KEY -w
#
# Only the keys you name are loaded. Anything else in the file is ignored, so a
# script can't pick up a key it didn't ask for.
#
# Works with the bash 3.2 that ships with macOS.

# Not `set -euo pipefail` here: this file is sourced, and changing the caller's
# shell options behind its back would be rude. Callers set their own.

_le_err() { printf 'load-env: %s\n' "$*" >&2; }

_le_valid_name() {
  case $1 in
    '' | [0-9]* | *[!A-Za-z0-9_]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Warn (once per file) if an env file can be read by other users.
_le_check_mode() {
  local f=$1 mode
  mode=$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f" 2>/dev/null || echo "")
  case $mode in
    '' | 600 | 400 | 700 | 500) ;;
    *) _le_err "warning: $f has mode $mode; other users may be able to read it. Run: chmod 600 $f" ;;
  esac
}

# _le_from_file FILE KEY -> sets _LE_VALUE and returns 0 if KEY is in FILE.
# Handles: comments, blank lines, `export KEY=...`, "double" and 'single'
# quotes, inline ` # comments` after unquoted values, and CRLF line endings.
# No variable expansion and no command execution: a .env file is data.
_le_from_file() {
  local file=$1 want=$2 line key val found=1
  _LE_VALUE=
  [ -r "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    case $line in '' | '#'*) continue ;; esac
    case $line in
      'export '*) line=${line#export}; line=${line#"${line%%[![:space:]]*}"} ;;
    esac
    case $line in *=*) ;; *) continue ;; esac
    key=${line%%=*}
    key=${key%"${key##*[![:space:]]}"}
    [ "$key" = "$want" ] || continue
    val=${line#*=}
    val=${val#"${val%%[![:space:]]*}"}
    case $val in
      \"*) val=${val#\"}; val=${val%%\"*} ;;
      \'*) val=${val#\'}; val=${val%%\'*} ;;
      *)
        val=${val%%[[:space:]]#*}
        val=${val%"${val##*[![:space:]]}"}
        ;;
    esac
    _LE_VALUE=$val
    found=0 # keep going: like most .env loaders, the last definition wins
  done <"$file"
  return $found
}

# _le_from_keychain SERVICE KEY -> sets _LE_VALUE and returns 0 if found.
_le_from_keychain() {
  local service=$1 key=$2 val
  _LE_VALUE=
  [ -n "$service" ] || return 1
  command -v security >/dev/null 2>&1 || return 1
  val=$(security find-generic-password -s "$service" -a "$key" -w 2>/dev/null) || return 1
  [ -n "$val" ] || return 1
  _LE_VALUE=$val
  return 0
}

# _le_lookup KEY FILE SERVICE -> sets _LE_VALUE and _LE_SOURCE, returns 0 if found.
_le_lookup() {
  local key=$1 file=$2 service=$3 current
  _LE_VALUE=
  _LE_SOURCE=
  eval "current=\${$key-}" # safe: $key was checked by _le_valid_name
  if [ -n "$current" ]; then
    _LE_VALUE=$current
    _LE_SOURCE=environment
    return 0
  fi
  if [ -n "$file" ] && _le_from_file "$file" "$key" && [ -n "$_LE_VALUE" ]; then
    _LE_SOURCE="file $file"
    return 0
  fi
  if _le_from_keychain "$service" "$key"; then
    _LE_SOURCE="Keychain service $service"
    return 0
  fi
  return 1
}

# load_env [--file PATH] [--service NAME | --keychain-service NAME] [--optional] KEY [KEY ...]
# Exports each KEY it finds. Returns 1 (after naming the missing keys, never
# any values) if a required key can't be found. --optional applies to every
# key in that call.
load_env() {
  local file="" service="${KEYCHAIN_SERVICE:-}" optional=0 missing="" key
  while [ $# -gt 0 ]; do
    case $1 in
      --file) file=${2-}; shift 2 ;;
      --service | --keychain-service) service=${2-}; shift 2 ;;
      --optional) optional=1; shift ;;
      --) shift; break ;;
      -*) _le_err "unknown option $1"; return 2 ;;
      *) break ;;
    esac
  done
  if [ -n "$file" ]; then
    if [ -f "$file" ]; then
      _le_check_mode "$file"
    elif [ "$optional" = 0 ]; then
      _le_err "note: $file not found; trying the environment and Keychain"
    fi
  fi
  for key in "$@"; do
    if ! _le_valid_name "$key"; then
      _le_err "not a valid variable name: $key"
      return 2
    fi
    if _le_lookup "$key" "$file" "$service"; then
      export "$key=$_LE_VALUE"
    elif [ "$optional" = 0 ]; then
      missing="$missing $key"
    fi
  done
  _LE_VALUE=
  if [ -n "$missing" ]; then
    _le_err "missing:$missing"
    _le_err "looked in: the environment${file:+, $file}${service:+, Keychain service $service}"
    return 1
  fi
  return 0
}

# Run directly: report where each key would come from, names only.
_le_check_main() {
  local file="" service="${KEYCHAIN_SERVICE:-}" key rc=0
  while [ $# -gt 0 ]; do
    case $1 in
      --check) shift ;;
      --file) file=${2-}; shift 2 ;;
      --service | --keychain-service) service=${2-}; shift 2 ;;
      -h | --help)
        sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        return 0
        ;;
      -*) _le_err "unknown option $1"; return 2 ;;
      *) break ;;
    esac
  done
  if [ $# -eq 0 ]; then
    _le_err "usage: load-env.sh --check [--file PATH] [--service NAME] KEY [KEY ...]"
    return 2
  fi
  [ -n "$file" ] && [ -f "$file" ] && _le_check_mode "$file"
  for key in "$@"; do
    if ! _le_valid_name "$key"; then
      printf '%-32s invalid name\n' "$key"
      rc=1
    elif _le_lookup "$key" "$file" "$service"; then
      printf '%-32s found (%s, %s chars)\n' "$key" "$_LE_SOURCE" "${#_LE_VALUE}"
    else
      printf '%-32s MISSING\n' "$key"
      rc=1
    fi
  done
  _LE_VALUE=
  return $rc
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  _le_check_main "$@"
fi
