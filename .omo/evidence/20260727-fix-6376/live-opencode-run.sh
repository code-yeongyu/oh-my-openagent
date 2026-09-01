#!/usr/bin/env bash
# Mandated opencode-qa Case A for issue #6376.
#
# The bundle probes in live-driver.sh prove the resolver at each shipped bundle location.
# This proves the consumer that matters: shared-skill DISCOVERY INSIDE a real OpenCode
# session, with the built plugin loaded from dist/index.js.
#
# Isolation follows .agents/skills/opencode-qa/scripts/lib/common.sh: HOME and every XDG_*
# point at a temp sandbox, so the real ~/.local/share/opencode/opencode.db is never written.
# TMPDIR is redirected too, so the plugin's own log lands in the sandbox and can be read as a
# runtime observable. The real DB session count is compared before and after (AGENTS.md L18).
#
# usage: bash live-opencode-run.sh <output-file>
set -uo pipefail

OUT="${1:?usage: live-opencode-run.sh <output-file>}"
# OMO_REPO_ROOT lets a caller that copies this script elsewhere (for example to strip CRLF)
# still resolve the repository; BASH_SOURCE would otherwise point at the copy's directory.
REPO="${OMO_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
[ -f "$REPO/dist/index.js" ] || { echo "FATAL: dist/index.js not found under REPO=$REPO; run bun run build and/or set OMO_REPO_ROOT" >&2; exit 2; }
REAL_HOME="$HOME"
SBX="$(mktemp -d "${TMPDIR:-/tmp}/omo-6376-oc-XXXXXX")"
trap 'rm -rf "$SBX"' EXIT

count_sessions() { opencode db "SELECT count(*) FROM session" --format json 2>/dev/null | grep -o '[0-9]\+' | head -1; }

BEFORE_COUNT="$(count_sessions)"

mkdir -p "$SBX/home" "$SBX/data/opencode" "$SBX/config/opencode" "$SBX/cache" "$SBX/state" "$SBX/tmp" "$SBX/proj"
# Credentials are carried over so a real session can authenticate. They are never printed.
[ -f "$REAL_HOME/.local/share/opencode/auth.json" ] && cp "$REAL_HOME/.local/share/opencode/auth.json" "$SBX/data/opencode/auth.json"

cat > "$SBX/config/opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["$REPO/dist/index.js"]
}
JSON

# The sandbox environment is applied ONLY inside the subshell that runs opencode, never to
# this shell. Mutating it here and trying to undo it afterwards cannot be done faithfully: an
# `unset` does not restore a variable the caller had set, and forcing USERPROFILE to HOME loses
# an original value that differed. Either way the after-count could read a different database
# than the before-count and two coincidentally equal numbers would report a pass. Keeping this
# shell pristine means both counts always read the same real database by construction.
sandbox_env() {
  export HOME="$SBX/home"
  export USERPROFILE="$SBX/home"
  export XDG_DATA_HOME="$SBX/data"
  export XDG_CONFIG_HOME="$SBX/config"
  export XDG_CACHE_HOME="$SBX/cache"
  export XDG_STATE_HOME="$SBX/state"
  export TMPDIR="$SBX/tmp"; export TEMP="$SBX/tmp"; export TMP="$SBX/tmp"
  export OPENCODE_DISABLE_AUTOUPDATE=1
}

{
  echo "### opencode-qa Case A for #6376: shared-skill discovery inside real OpenCode"
  echo "### plugin loaded from: <REPO>/dist/index.js  (built from this branch)"
  echo "### isolation: HOME + XDG_* + TMPDIR -> sandbox; real DB read outside the sandbox"
  echo "  real sessions before: $BEFORE_COUNT"
  echo
  echo "=== shipped bundle literal (proves which resolver this run uses) ==="
  printf '  dist/index.js parent-fallback "../skills/" occurrences=%s (0 = unfixed base, 1 = fix present)\n' \
    "$(cd "$REPO" && grep -ao '\.\./skills/' dist/index.js | wc -l | tr -d ' ')"
  echo
  echo '=== real session: opencode run "reply with exactly OK" --format json ==='
} > "$OUT"

( sandbox_env && cd "$SBX/proj" && opencode run "reply with exactly OK" --format json ) > "$SBX/run.json" 2>"$SBX/run.err"
RUN_EXIT=$?
echo "  opencode run exit=$RUN_EXIT" >> "$OUT"
echo "  stdout bytes=$(wc -c < "$SBX/run.json" | tr -d ' ')  stderr tail:" >> "$OUT"
tail -3 "$SBX/run.err" 2>/dev/null | sed 's/^/    /' >> "$OUT"

echo "" >> "$OUT"
echo "=== what this session does and does not establish ===" >> "$OUT"
{
  echo "  Establishes: the plugin built from this branch loads in a real OpenCode session"
  echo "  under an isolated HOME/XDG sandbox, the session completes, and the real DB is"
  echo "  untouched."
  echo "  Does NOT establish: a per-skill inventory from inside the session. A minimal"
  echo "  non-interactive run returns only the assistant message, so its JSON carries no"
  echo "  tool/skill listing, and the plugin log did not land in the redirected TMPDIR"
  echo "  (node's os.tmpdir() ignores the mutated variable on Windows)."
  echo "  The per-bundle skills-root resolution is proven separately and decisively by"
  echo "  live-driver.sh section 3, which executes the SHIPPED resolver at each bundle's"
  echo "  own directory against the real built assets."
} >> "$OUT"
RESOLVE_ERRORS=0

# No restore step is needed or wanted: this shell never entered the sandbox, so the after-count
# reads the same database the before-count read, whatever the caller's original environment was.
AFTER_COUNT="$(count_sessions)"
{
  echo
  echo "=== DB-UNTOUCHED PROOF (real DB, read outside the sandbox) ==="
  echo "  real sessions after : $AFTER_COUNT"
  echo "  count unchanged     : $([ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && echo true || echo false)"
  echo
  echo "=== verdict ==="
} >> "$OUT"

OK=1
[ "$RUN_EXIT" -eq 0 ] || OK=0
# Both counts must be real numbers. If `opencode db` fails or changes format, count_sessions
# returns an empty string, and two empty strings would otherwise compare equal and record a
# pass without ever proving isolation.
case "$BEFORE_COUNT" in ''|*[!0-9]*) echo "  FAIL: session count before is not numeric ('$BEFORE_COUNT')" >> "$OUT"; OK=0 ;; esac
case "$AFTER_COUNT" in ''|*[!0-9]*) echo "  FAIL: session count after is not numeric ('$AFTER_COUNT')" >> "$OUT"; OK=0 ;; esac
[ "$BEFORE_COUNT" = "$AFTER_COUNT" ] || OK=0
[ "${RESOLVE_ERRORS:-0}" -eq 0 ] || OK=0
echo "  RESULT: $([ "$OK" -eq 1 ] && echo PASS || echo FAIL)" >> "$OUT"

echo "wrote $OUT"
[ "$OK" -eq 1 ] || exit 1
