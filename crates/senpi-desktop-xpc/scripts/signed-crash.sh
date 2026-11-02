#!/bin/bash
# Real signed engine + controller; cfg(test) substitutes only input hardware.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
export TMPDIR=/tmp/cu10207
export PATH="$HOME/.rustup/toolchains/1.99.0-aarch64-apple-darwin/bin:$PATH"
mkdir -p "$TMPDIR"
work="$(mktemp -d "$TMPDIR/o2-crash.XXXXXX")"
service="ai.sisyphuslabs.o2crash.${work##*.}"
label="$service.agent"
domain="gui/$(id -u)"
identity='Developer ID Application: Yeongyu Kim (523JNR86LZ)'
client_pid=""
cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [[ -n "$client_pid" ]]; then
        kill -9 "$client_pid" 2>/dev/null || true
        wait "$client_pid" 2>/dev/null || true
    fi
    launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
        echo "CLEANUP FAILED crash job remains"; status=1
    else
        echo "CLEANUP crash job REMOVED"
    fi
    if [[ "$status" != 0 ]]; then
        for log in "$work/stderr" "$work/client.log"; do
            if [[ -f "$log" ]]; then
                while IFS= read -r line; do printf 'FIXTURE_LOG %s\n' "$line"; done < "$log"
            fi
        done
    fi
    if pgrep -f "$work/" >/dev/null; then
        echo "CLEANUP FAILED crash process remains"; status=1
    else
        echo "CLEANUP crash processes 0"
    fi
    rm -rf "$work"
    [[ ! -e "$work" ]] && echo "CLEANUP crash directory REMOVED"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$root"
engine="$(cargo test -p senpi-desktop-engine --bin senpi-desktop-engine --no-run --message-format=json |
    bun -e 'for (const line of (await Bun.stdin.text()).split("\n")) {
      if (!line.trim()) continue;
      const v = JSON.parse(line);
      if (v.reason === "compiler-artifact" && v.target.name === "senpi-desktop-engine" && v.profile.test && v.executable) console.log(v.executable);
    }')"
[[ -f "$engine" ]]
cargo build -p senpi-desktop-xpc --example xpc_fixture
bundle() {
    local name="$1" id="$2" source="$3" app="$work/$1.app"
    mkdir -p "$app/Contents/MacOS"
    cp "$source" "$app/Contents/MacOS/fixture"
    {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>' \
            '<key>CFBundleExecutable</key><string>fixture</string>' \
            '<key>CFBundlePackageType</key><string>APPL</string>' \
            '<key>OmODesktopSecurityEpoch</key><string>xpc-1</string>'
        printf '<key>CFBundleIdentifier</key><string>%s</string>\n' "$id"
        printf '%s\n' '</dict></plist>'
    } > "$app/Contents/Info.plist"
    codesign --force --sign "$identity" --timestamp=none --options runtime,hard,kill "$app"
    codesign --verify --strict "$app"
}
bundle agent ai.sisyphuslabs.senpi-desktop-engine.xpc-v1 "$engine"
bundle client ai.sisyphuslabs.senpi-desktop-controller.xpc-v1 target/debug/examples/xpc_fixture
mkdir -m 700 "$work/state"
mkfifo "$work/events"
exec 3<> "$work/events"
{
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>'
    printf '<key>Label</key><string>%s</string>\n' "$label"
    printf '<key>ProgramArguments</key><array><string>%s/agent.app/Contents/MacOS/fixture</string><string>--exact</string><string>xpc_tests::global_stop_latches_all_clients</string><string>--nocapture</string></array>\n' "$work"
    printf '<key>EnvironmentVariables</key><dict><key>OMO_XPC_TEST_STATE_DIR</key><string>%s/state</string><key>OMO_XPC_TEST_SERVICE</key><string>%s</string></dict>\n' "$work" "$service"
    printf '<key>MachServices</key><dict><key>%s</key><true/></dict>\n' "$service"
    printf '<key>StandardOutPath</key><string>%s/events</string>\n' "$work"
    printf '<key>StandardErrorPath</key><string>%s/stderr</string>\n' "$work"
    printf '%s\n' '<key>RunAtLoad</key><true/>' '<key>LimitLoadToSessionType</key><string>Aqua</string>' '</dict></plist>'
} > "$work/agent.plist"
marker() {
    local expected="$1" line
    while IFS= read -r -t 20 line <&3; do
        printf '%s\n' "$line"
        [[ "$line" == "$expected" ]] && return 0
    done
    echo "FAIL missing engine event: $expected"
    return 1
}
launchctl bootstrap "$domain" "$work/agent.plist"
marker "XPC_TEST_READY stopped=false"
client="$work/client.app/Contents/MacOS/fixture"
"$client" crash-hold "$service" > "$work/client.log" 2>&1 &
client_pid=$!
marker XPC_TEST_KEY_DOWN
kill -9 "$client_pid"
set +e
wait "$client_pid"
killed=$?
set -e
client_pid=""
[[ "$killed" == 137 ]]
echo "CRASH_CLIENT_SIGKILL status=137"
marker XPC_TEST_KEY_UP
marker XPC_TEST_SESSION_CLOSED
"$client" crash-grant "$service"
marker XPC_TEST_SESSION_CLOSED
echo "CASE killed signed client key release session close fresh control PASS"
echo "SUMMARY signed crash cases=1 unexpected=0"
