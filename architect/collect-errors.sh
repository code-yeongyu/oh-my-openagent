#!/usr/bin/env bash
# MaTrix Architect — Error Signal Collector
# Scans recent session/error sources and appends normalized ErrorSignal
# JSON lines to .matrix/logs/errors.jsonl (consumed by the self-improvement
# engine L1: detectRecurringErrors -> applyLevel1).
#
# Idempotent per cycle: only files modified since the last scan are read, so
# the same historical errors are not re-appended every 4h.
set -euo pipefail

HOME_DIR="/home/shiro"
LOG_DIR="$HOME_DIR/.matrix/logs"
ERR_FILE="$LOG_DIR/errors.jsonl"
MARKER="$LOG_DIR/.last-error-scan"
NOW=$(date -u +%s)
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

mkdir -p "$LOG_DIR"

# Scan window: files modified since last scan (fallback ~4h15m)
if [ -f "$MARKER" ]; then
  SINCE=$(cat "$MARKER")
else
  SINCE=$((NOW - 15300))
fi
SINCE_HUMAN=$(date -u -d "@$SINCE" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)

mapfile -t FILES < <(
  find "$HOME_DIR/.hermes/profiles/kaly/sessions" -type f \( -name "*.db" -o -name "*.json" \) -newermt "@$SINCE" 2>/dev/null
  find "$HOME_DIR/matrix-port/dashboard" -type f -name "dashboard.log" -newermt "@$SINCE" 2>/dev/null
)

emit() {
  local agent="$1" etype="$2" msg="$3" sid="$4"
  python3 -c "import json,sys; print(json.dumps({'agent':sys.argv[1],'errorType':sys.argv[2],'message':sys.argv[3][:200],'timestamp':sys.argv[4],'sessionId':sys.argv[5]}))" \
    "$agent" "$etype" "$msg" "$NOW_ISO" "$sid" >> "$ERR_FILE"
}

COUNT=0
for f in "${FILES[@]:-}"; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  while IFS= read -r m; do emit "session:$base" "timeout" "timeout detected: $m" "$base"; COUNT=$((COUNT+1)); done < <(strings "$f" 2>/dev/null | grep -iE "timeout" | head -3)
  while IFS= read -r m; do emit "session:$base" "api-error" "api error: $m" "$base"; COUNT=$((COUNT+1)); done < <(strings "$f" 2>/dev/null | grep -iE "5[0-9][0-9]|api error|api fail" | head -3)
  while IFS= read -r m; do emit "session:$base" "runtime-error" "error: $m" "$base"; COUNT=$((COUNT+1)); done < <(strings "$f" 2>/dev/null | grep -iE "exception|error:|failed" | head -3)
done

echo "$NOW" > "$MARKER"
echo "collect-errors: scanned ${#FILES[@]} files since $SINCE_HUMAN, emitted $COUNT signals (errors.jsonl now $(wc -l < "$ERR_FILE" 2>/dev/null || echo 0) lines)"
