#!/usr/bin/env bash
# MaTrix Architect — Session Scanner
# Analyses Hermes sessions, detects error patterns,
# and generates improvement proposals
set -euo pipefail

ARCHITECT_STATE="/home/shiro/matrix-port/.matrix/state/architect_state.json"
SESSIONS_DIR="/home/shiro/.hermes/profiles/kaly/sessions"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

ERRORS=0
SESSION_COUNT=0
declare -a ERROR_PATTERNS
declare -a RECOMMENDATIONS

if [ -d "$SESSIONS_DIR" ]; then
  SESSION_COUNT=$(find "$SESSIONS_DIR" -name "*.db" -mtime -7 2>/dev/null | wc -l)

  for f in $(find "$SESSIONS_DIR" -name "*.db" -mtime -7 2>/dev/null | head -50); do
    COUNT=$(strings "$f" 2>/dev/null | grep -ciE "error|exception|failed|timeout" || echo 0)
    ERRORS=$((ERRORS + COUNT))

    TIMEOUTS=$(strings "$f" 2>/dev/null | grep -ci "timeout" || echo 0)
    if [ "$TIMEOUTS" -gt 2 ]; then
      ERROR_PATTERNS+=("timeout:${TIMEOUTS}")
    fi

    API_ERRORS=$(strings "$f" 2>/dev/null | grep -ciE "api.*error|api.*fail|5[0-9][0-9]" || echo 0)
    if [ "$API_ERRORS" -gt 2 ]; then
      ERROR_PATTERNS+=("api:${API_ERRORS}")
    fi
  done
fi

GENERATED_RECS="[]"
if [ -n "${ERROR_PATTERNS+x}" ] && [ ${#ERROR_PATTERNS[@]} -gt 0 ]; then
  GENERATED_RECS=$(python3 -c "
import json
recs = []
for p in '${ERROR_PATTERNS[@]}':
    if p.startswith('timeout:'):
        recs.append({
            'type': 'performance',
            'priority': 'medium',
            'message': 'Timed out tasks detected',
            'action': 'Increase timeout or parallelize calls',
            'auto_fix': True
        })
    if p.startswith('api:'):
        recs.append({
            'type': 'reliability',
            'priority': 'high',
            'message': 'Recurring API errors',
            'action': 'Add retry with backoff to API calls',
            'auto_fix': False
        })
print(json.dumps(recs))
" 2>/dev/null || echo "[]")
fi

UPSTREAM_DIFF=$(python3 -c "
import json
try:
    with open('$ARCHITECT_STATE') as f:
        s = json.load(f)
    print(s.get('upstreamDiff', 0))
except:
    print(0)
" 2>/dev/null || echo 0)

mkdir -p "$(dirname "$ARCHITECT_STATE")"
python3 << PYEOF
import json, datetime

state = {}
try:
  with open("$ARCHITECT_STATE") as f:
    state = json.load(f)
except:
  pass

state["lastScan"] = "$NOW"
state["errorsDetected"] = $ERRORS
state["sessionsScanned"] = $SESSION_COUNT
state["cycle"] = state.get("cycle", 0) + 1

if "history" not in state:
  state["history"] = []
state["history"].append({
  "time": "$NOW",
  "errors": $ERRORS,
  "sessions": $SESSION_COUNT,
  "upstreamDiff": $UPSTREAM_DIFF
})
state["history"] = state["history"][-20:]

try:
  recs = $GENERATED_RECS
  state["recommendations"] = recs
  state["pendingProposals"] = len(recs)
except:
  pass

if $UPSTREAM_DIFF > 0:
  upRec = {
    "type": "upstream",
    "priority": "medium",
    "message": f"OMO ${UPSTREAM_DIFF} versions behind",
    "action": "Review upstream changes for useful features",
    "auto_fix": False
  }
  if "recommendations" not in state:
    state["recommendations"] = []
  state["recommendations"].append(upRec)
  state["pendingProposals"] = len(state["recommendations"])

with open("$ARCHITECT_STATE", "w") as f:
  json.dump(state, f, indent=2)

print(f"Cycle #{state['cycle']}: $SESSION_COUNT sessions, $ERRORS errors, {len(state.get('recommendations', []))} recommendations")
PYEOF
