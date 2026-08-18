#!/usr/bin/env bash
set -euo pipefail
set -o pipefail

SANDBOX="" SANDBOX2=""
export SENPI_BIN=/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat-senpi-onboarding-init-deep-advisor/packages/omo-senpi/plugin/extensions/omo.js
MOCK_PROVIDER="$PWD/packages/omo-senpi/scripts/qa/mock-provider/index.ts"

cleanup() { rm -rf -- "${SANDBOX:-}" "${SANDBOX2:-}"; }
trap cleanup EXIT

count_matches() {
  local pattern=$1 file=$2
  { rg "$pattern" "$file" || test $? -eq 1; } | wc -l | tr -d ' '
}

prepare_sandbox() {
  local sandbox=$1
  mkdir -p "$sandbox/home" "$sandbox/xdg"
  printf '{"extensions":["%s"]}\n' "$SENPI_BIN" > "$sandbox/settings.json"
  printf '{"%s":true}\n' "$(pwd -P)" > "$sandbox/trust.json"
}

run_print() {
  local sandbox=$1 output=$2
  shift 2
  HOME="$sandbox/home" USERPROFILE="$sandbox/home" XDG_CONFIG_HOME="$sandbox/xdg" \
    SENPI_CODING_AGENT_DIR="$sandbox" PI_CODING_AGENT_DIR="$sandbox" \
    senpi -e "$MOCK_PROVIDER" --provider omo-mock --model mock-1 "$@" --print "test" 2>&1 | tee "$output"
}

SANDBOX=$(mktemp -d)
export SENPI_CODING_AGENT_DIR="$SANDBOX"
prepare_sandbox "$SANDBOX"
run_print "$SANDBOX" /tmp/qa-a.txt
SESSION_A=$(find "$SANDBOX/sessions" -name "*.jsonl" -type f | head -1)
test "$(count_matches "omo-onboarding:bootstrap" "$SESSION_A")" -eq 1
test "$(count_matches "Read the onboarding skill at" "$SESSION_A")" -eq 1
test -f "$SANDBOX/omo-senpi/omo-native/onboarding-completed"
printf 'scenario a PASS: first startup injected once and marker exists\n' >> /tmp/qa-a.txt

run_print "$SANDBOX" /tmp/qa-b.txt
SESSION_B=$(find "$SANDBOX/sessions" -name "*.jsonl" -type f | sort -r | head -1)
test "$(count_matches "omo-onboarding:bootstrap" "$SESSION_B")" -eq 0
printf 'scenario b PASS: second startup suppressed onboarding\n' >> /tmp/qa-b.txt

MARKER_INODE=$(stat -f '%i' "$SANDBOX/omo-senpi/omo-native/onboarding-completed")
MARKER_CONTENT=$(cat "$SANDBOX/omo-senpi/omo-native/onboarding-completed")
run_print "$SANDBOX" /tmp/qa-c.txt --onboard
SESSION_C=$(find "$SANDBOX/sessions" -name "*.jsonl" -type f | sort -r | head -1)
test "$(count_matches "omo-onboarding:bootstrap" "$SESSION_C")" -eq 1
test "$(stat -f '%i' "$SANDBOX/omo-senpi/omo-native/onboarding-completed")" = "$MARKER_INODE"
test "$(cat "$SANDBOX/omo-senpi/omo-native/onboarding-completed")" = "$MARKER_CONTENT"
printf 'scenario c PASS: force injected once without replacing marker\n' >> /tmp/qa-c.txt

SANDBOX2=$(mktemp -d)
export SENPI_CODING_AGENT_DIR="$SANDBOX2"
prepare_sandbox "$SANDBOX2"
run_print "$SANDBOX2" /tmp/qa-d.txt --omo-senpi-onboarding-disabled
SESSION_D=$(find "$SANDBOX2/sessions" -name "*.jsonl" -type f | head -1)
test "$(count_matches "omo-onboarding:bootstrap" "$SESSION_D")" -eq 0
test ! -f "$SANDBOX2/omo-senpi/omo-native/onboarding-completed"
printf 'scenario d PASS: disabled startup wrote no marker\n' >> /tmp/qa-d.txt

node packages/omo-senpi/src/components/init-deep-advisor/qa-rpc-driver.mjs e && test $? -eq 0
node packages/omo-senpi/src/components/init-deep-advisor/qa-rpc-driver.mjs f && test $? -eq 0

cleanup
test ! -e "$SANDBOX" && test ! -e "$SANDBOX2"
printf 'cleanup PASS: shell and RPC sandboxes removed\n'
test $? -eq 0
