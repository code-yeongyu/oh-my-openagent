#!/bin/sh
# Orchestrates the isolated QA for issue #6724 under /tmp/opencode/issue-6724.
# Sandboxes HOME/XDG/OPENCODE_CONFIG_DIR; never touches real ~/.config/opencode.
set -u
QA=/tmp/opencode/issue-6724
rm -rf "$QA/run" "$QA/mock-state" "$QA/sandbox"
mkdir -p "$QA/run" "$QA/sandbox/home" "$QA/sandbox/config" "$QA/sandbox/data" "$QA/sandbox/cache" "$QA/sandbox/state" "$QA/sandbox/opencode-config"
chmod +x "$QA/stub-bin/xdg-open"

sandbox_env='HOME=/tmp/opencode/issue-6724/sandbox/home
XDG_CONFIG_HOME=/tmp/opencode/issue-6724/sandbox/config
XDG_DATA_HOME=/tmp/opencode/issue-6724/sandbox/data
XDG_CACHE_HOME=/tmp/opencode/issue-6724/sandbox/cache
XDG_STATE_HOME=/tmp/opencode/issue-6724/sandbox/state
OPENCODE_CONFIG_DIR=/tmp/opencode/issue-6724/sandbox/opencode-config
NODE_EXTRA_CA_CERTS=/tmp/opencode/issue-6724/certs/cert.pem'

echo "=== starting mock oauth server ==="
env -i PATH="$PATH" HOME="$QA/sandbox/home" bun "$QA/mock-oauth-server.ts" > "$QA/mock-server.log" 2>&1 &
MOCK_PID=$!
for i in $(seq 1 50); do
  [ -f "$QA/mock-port.txt" ] && break
  sleep 0.1
done
if [ ! -f "$QA/mock-port.txt" ]; then
  echo "mock server failed to start"; cat "$QA/mock-server.log"; kill $MOCK_PID 2>/dev/null; exit 1
fi
echo "mock port: $(cat "$QA/mock-port.txt")"

echo "=== run 1: default platform opener via PATH-stubbed xdg-open ==="
env -i \
  PATH="$QA/stub-bin:$PATH" \
  HOME="$QA/sandbox/home" \
  XDG_CONFIG_HOME="$QA/sandbox/config" \
  XDG_DATA_HOME="$QA/sandbox/data" \
  XDG_CACHE_HOME="$QA/sandbox/cache" \
  XDG_STATE_HOME="$QA/sandbox/state" \
  OPENCODE_CONFIG_DIR="$QA/sandbox/opencode-config" \
  NODE_EXTRA_CA_CERTS="$QA/certs/cert.pem" \
  OMO_QA_OPEN_URL_FILE="$QA/run/default-opener-url.txt" \
  bun "$QA/qa-driver.ts" default
DEFAULT_EXIT=$?
echo "default-mode exit: $DEFAULT_EXIT"

echo "=== run 2: injected opener seam ==="
env -i \
  PATH="$PATH" \
  HOME="$QA/sandbox/home" \
  XDG_CONFIG_HOME="$QA/sandbox/config" \
  XDG_DATA_HOME="$QA/sandbox/data" \
  XDG_CACHE_HOME="$QA/sandbox/cache" \
  XDG_STATE_HOME="$QA/sandbox/state" \
  OPENCODE_CONFIG_DIR="$QA/sandbox/opencode-config" \
  NODE_EXTRA_CA_CERTS="$QA/certs/cert.pem" \
  bun "$QA/qa-driver.ts" injected
INJECTED_EXIT=$?
echo "injected-mode exit: $INJECTED_EXIT"

kill $MOCK_PID 2>/dev/null

echo "=== sandbox tree (isolation proof) ==="
find "$QA/sandbox" -type f | sort

if [ "$DEFAULT_EXIT" = "0" ] && [ "$INJECTED_EXIT" = "0" ]; then
  echo "QA-OVERALL-PASS"
else
  echo "QA-OVERALL-FAIL"
  exit 1
fi
