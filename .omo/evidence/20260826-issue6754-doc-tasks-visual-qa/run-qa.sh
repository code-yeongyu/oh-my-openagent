#!/usr/bin/env bash
# Isolation harness for issue-6754 QA. Sandboxes every home/xdg location the
# plugin could touch and proves the real user dirs are untouched before+after
# using bounded stat checks (these dirs are far too large for full digests).
set -u
SB=/tmp/opencode/issue-6754/sandbox
rm -rf "$SB"
mkdir -p "$SB/home" "$SB/data" "$SB/config" "$SB/state" "$SB/cache"

REAL_MO="$HOME/.omo"
REAL_OC="$HOME/.config/opencode"
REAL_CODEX="$HOME/.codex"
REAL_CACHE="$HOME/.cache/opencode"
MARKER=/tmp/opencode/issue-6754/isolation-marker
date +%s > "$MARKER"

snap() {
  local label="$1" path="$2"
  if [ ! -e "$path" ]; then
    echo "$label ABSENT"
  else
    echo "$label mtime=$(stat -c %Y "$path") fresh_recent=$(timeout 10 find "$path" -maxdepth 2 -type f -newer "$MARKER" 2>/dev/null | wc -l)"
  fi
}

{
echo "=== ISOLATION PROOF (before, marker=$(cat "$MARKER")) ==="
snap "real_omo" "$REAL_MO"
snap "real_opencode_config" "$REAL_OC"
snap "real_codex" "$REAL_CODEX"
snap "real_opencode_cache" "$REAL_CACHE"
} > /tmp/opencode/issue-6754/isolation-before.log

export XDG_DATA_HOME="$SB/data" XDG_CONFIG_HOME="$SB/config" XDG_STATE_HOME="$SB/state" XDG_CACHE_HOME="$SB/cache" HOME="$SB/home"
export OMO_CODING_AGENT_DIR="$SB/home/.omo" CODEX_HOME="$SB/codex-home"
mkdir -p "$CODEX_HOME"

cd /home/viprix/projects/oom-wt-6754 || exit 9
bun .omo/evidence/20260826-issue6754-doc-tasks-visual-qa/qa-loader-proof.ts > /tmp/opencode/issue-6754/qa-transcript.log 2>&1
QA_EXIT=$?

sleep 1
{
echo "=== ISOLATION PROOF (after) ==="
snap "real_omo" "$REAL_MO"
snap "real_opencode_config" "$REAL_OC"
snap "real_codex" "$REAL_CODEX"
snap "real_opencode_cache" "$REAL_CACHE"
} > /tmp/opencode/issue-6754/isolation-after.log

echo "=== SANDBOX WRITES (what the QA run created inside the sandbox) ===" >> /tmp/opencode/issue-6754/qa-transcript.log
find "$SB" -type f | head -50 >> /tmp/opencode/issue-6754/qa-transcript.log
echo "QA_EXIT=$QA_EXIT" >> /tmp/opencode/issue-6754/qa-transcript.log
exit $QA_EXIT
