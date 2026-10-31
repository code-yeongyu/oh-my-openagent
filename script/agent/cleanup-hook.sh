#!/usr/bin/env bash
# Non-blocking Claude Code SessionEnd launcher for cleanup.sh.
#
# Claude may cancel shutdown hooks while the session is closing. Keep this hook
# tiny and best-effort, then let cleanup.sh do strict synchronous work outside
# the hook process.
set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLEANUP_SCRIPT="$PROJECT_DIR/script/agent/cleanup.sh"
# The log must never land inside the project tree: cleanup.sh prunes transient
# files there and a log write could clobber a tracked file. Any absolute,
# existing temp directory outside the project is accepted, so the hook works on
# hosts whose TMPDIR lives outside /tmp. A rejected TMPDIR falls back to /tmp
# and SAYS SO on stderr instead of substituting silently (#10735).
physical_path() {
  (cd -P "$1" 2>/dev/null && pwd -P) || return 1
}

# Directory identity, not its name: device+inode is immune to case-insensitive
# filesystems, Unicode normalisation, symlinks and hard-linked directories.
# The stat flavour is detected by TRYING it, never guessed from uname: GNU
# coreutils on PATH under macOS makes `stat -f` print a filesystem report and
# exit 1, which must never be mistaken for an identity.
identity_shape_ok() {
  case "$1" in
    '' | *[!0-9:]* | :* | *: | *:*:*) return 1 ;;
    *:*) return 0 ;;
    *) return 1 ;;
  esac
}

stat_flavour=""
for stat_option in -c -f; do
  stat_probe="$(stat "$stat_option" '%d:%i' . 2>/dev/null)" || continue
  if identity_shape_ok "$stat_probe"; then
    stat_flavour="$stat_option"
    break
  fi
done

# Prints the identity and exits 0, or exits non-zero: an unreadable path, a
# missing stat, an unknown flavour and unexpected output are all failures.
path_identity() {
  [ -n "$stat_flavour" ] || return 1
  identity="$(stat "$stat_flavour" '%d:%i' "$1" 2>/dev/null)" || return 1
  identity_shape_ok "$identity" || return 1
  printf '%s\n' "$identity"
}

# 0 = inside the project, 1 = outside, 2 = undecidable (fail closed).
is_inside_project() {
  walk="$1"
  while :; do
    walk_identity="$(path_identity "$walk")" || return 2
    [ "$walk_identity" = "$project_identity" ] && return 0
    [ "$walk" = "/" ] && return 1
    walk_parent="$(dirname "$walk")"
    [ "$walk_parent" = "$walk" ] && return 1
    walk="$walk_parent"
  done
}

# The first existing directory that resolves and is outside the project. These
# are existing system temp directories only: the hook CREATES NOTHING, so a
# rejected TMPDIR cannot leave a trail of temp directories behind it.
fallback_log_dir() {
  for fallback in /tmp /private/tmp /var/tmp /private/var/tmp; do
    [ -d "$fallback" ] || continue
    fallback_physical="$(physical_path "$fallback")" || continue
    is_inside_project "$fallback_physical"
    [ "$?" = "1" ] || continue
    printf '%s\n' "${fallback_physical%/}"
    return 0
  done
  return 1
}

resolve_log_dir() {
  candidate="${TMPDIR:-/tmp}"
  reason=""
  physical_project="$(physical_path "$PROJECT_DIR")" || physical_project=""
  project_identity=""
  if [ -n "$physical_project" ]; then
    project_identity="$(path_identity "$physical_project")" || project_identity=""
  fi
  if [ -z "$project_identity" ]; then
    printf '[cleanup-hook] the project directory cannot be identified (%s); not logging\n' "$PROJECT_DIR" >&2
    return 0
  fi
  case "$candidate" in
    "") reason="TMPDIR is empty" ;;
    *..*) reason="TMPDIR contains '..'" ;;
    /*) ;;
    *) reason="TMPDIR is not an absolute path" ;;
  esac
  if [ -z "$reason" ] && [ ! -d "$candidate" ]; then
    reason="TMPDIR is not an existing directory"
  fi
  # Compare PHYSICAL paths: a string prefix test is bypassed by a symlinked
  # TMPDIR, a symlinked project path, '//' or '/./' segments. Unresolvable
  # paths fail closed.
  if [ -z "$reason" ]; then
    physical_candidate="$(physical_path "$candidate")" || reason="TMPDIR cannot be resolved to a physical path"
  fi
  if [ -z "$reason" ]; then
    is_inside_project "$physical_candidate"
    case "$?" in
      0) reason="TMPDIR is inside the project directory" ;;
      2) reason="TMPDIR could not be compared with the project directory" ;;
    esac
  fi
  if [ -n "$reason" ]; then
    fallback="$(fallback_log_dir)" || fallback=""
    if [ -z "$fallback" ]; then
      printf '[cleanup-hook] %s (%s) and no temp directory outside the project is available; not logging\n' "$reason" "$candidate" >&2
      return 0
    fi
    printf '[cleanup-hook] %s (%s); logging under %s instead\n' "$reason" "$candidate" "$fallback" >&2
    printf '%s\n' "$fallback"
    return 0
  fi
  printf '%s\n' "${physical_candidate%/}"
}

LOG_DIR="$(resolve_log_dir)"
if [ -n "$LOG_DIR" ]; then
  LOG_FILE="${LOG_DIR%/}/oh-my-openagent-cleanup.log"
else
  LOG_FILE="/dev/null"
fi

# Single source of truth for the resolved log path, so callers (tests included)
# read the path this hook actually uses instead of re-implementing the rules.
if [ "${1:-}" = "--print-log-file" ]; then
  printf '%s\n' "$LOG_FILE"
  exit 0
fi

if [ ! -f "$CLEANUP_SCRIPT" ]; then
  printf '[cleanup-hook] missing cleanup script: %s\n' "$CLEANUP_SCRIPT" >&2
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

if [ "${OMO_AGENT_CLEANUP_SYNC:-0}" = "1" ]; then
  bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 || true
  exit 0
fi

if command -v nohup >/dev/null 2>&1; then
  nohup bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 </dev/null &
else
  bash "$CLEANUP_SCRIPT" >>"$LOG_FILE" 2>&1 </dev/null &
fi

disown "$!" 2>/dev/null || true
exit 0
