#!/bin/bash
# Drives the EXTRACTED gate body against a mocked registry.
# MOCK_MISSING: space-separated package names that 404
# MOCK_HEAL_AFTER: round number after which missing packages start returning 200
# MOCK_CURL_FAIL: package name for which curl itself exits nonzero
run_case() {
  local name="$1"; shift
  local expect_exit="$1"; shift
  local out rc
  out="$(env "$@" VERSION=5.0.0-beta.24 PROPAGATION_DELAY=0 bash -c '
    ROUND=0
    curl() {
      local url="${@: -1}"
      local pkg="${url#https://registry.npmjs.org/}"; pkg="${pkg%%/*}"
      ROUND_FILE=/tmp/.gate_round
      if [ "$pkg" = "${MOCK_CURL_FAIL:-}" ]; then return 7; fi
      local r; r=$(cat "$ROUND_FILE" 2>/dev/null || echo 1)
      case " ${MOCK_MISSING:-} " in
        *" $pkg "*)
          if [ -n "${MOCK_HEAL_AFTER:-}" ] && [ "$r" -gt "$MOCK_HEAL_AFTER" ]; then echo 200; else echo 404; fi ;;
        *) echo 200 ;;
      esac
    }
    sleep() { local r; r=$(cat /tmp/.gate_round 2>/dev/null || echo 1); echo $((r+1)) > /tmp/.gate_round; }
    export -f curl sleep
    echo 1 > /tmp/.gate_round
    source /tmp/gate.sh
  ' 2>&1)"; rc=$?
  local verdict="FAIL"; [ "$rc" = "$expect_exit" ] && verdict="PASS"
  printf '%-46s exit=%s expect=%s  %s\n' "$name" "$rc" "$expect_exit" "$verdict"
  [ "$verdict" = "FAIL" ] && echo "$out" | tail -6
  echo "$out" | grep -cE '^OK ' | sed 's/^/    OK lines: /'
  echo "$out" | grep -E 'Waiting for platform|All 24|::error::' | head -4 | sed 's/^/    /'
}
run_case "A: all visible immediately" 0 MOCK_MISSING=
run_case "B: 3 lag, heal after round 2" 0 MOCK_MISSING="oh-my-opencode-windows-x64-baseline oh-my-opencode-windows-arm64 oh-my-openagent-windows-arm64" MOCK_HEAL_AFTER=2
run_case "C: 1 never appears -> hard fail" 1 MOCK_MISSING="oh-my-openagent-windows-arm64" PROPAGATION_ATTEMPTS=3
run_case "D: curl transient failure" 1 MOCK_CURL_FAIL="oh-my-opencode-linux-x64" PROPAGATION_ATTEMPTS=2
