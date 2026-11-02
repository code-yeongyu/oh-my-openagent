#!/bin/bash
# Real signed XPC engine process; only path/hardware isolation is cfg(test).
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
export TMPDIR=/tmp/cu10207
export PATH="$HOME/.rustup/toolchains/1.99.0-aarch64-apple-darwin/bin:$PATH"
mkdir -p "$TMPDIR"
work="$(mktemp -d "$TMPDIR/o2-latch.XXXXXX")"
service="ai.sisyphuslabs.o2latch.${work##*.}"
label="$service.agent"
domain="gui/$(id -u)"
identity='Developer ID Application: Yeongyu Kim (523JNR86LZ)'
cleanup() {
    status=$?
    trap - EXIT INT TERM
    launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
        echo "CLEANUP FAILED job remains"
        status=1
    else
        echo "CLEANUP job REMOVED: $label"
    fi
    if [[ "$status" != 0 && -f "$work/stderr" ]]; then
        while IFS= read -r line; do printf 'FIXTURE_LOG %s\n' "$line"; done < "$work/stderr"
    fi
    if pgrep -f "$work/" >/dev/null; then
        echo "CLEANUP FAILED fixture process remains"
        status=1
    else
        echo "CLEANUP processes 0"
    fi
    rm -rf "$work"
    [[ ! -e "$work" ]] && echo "CLEANUP fixture directory REMOVED"
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
    local name="$1" id="$2" source="$3"
    local app="$work/$name.app"
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
mkfifo "$work/ready"
exec 3<> "$work/ready"
{
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>'
    printf '<key>Label</key><string>%s</string>\n' "$label"
    printf '<key>ProgramArguments</key><array><string>%s/agent.app/Contents/MacOS/fixture</string><string>--exact</string><string>xpc_tests::global_stop_latches_all_clients</string><string>--nocapture</string></array>\n' "$work"
    printf '<key>EnvironmentVariables</key><dict><key>OMO_XPC_TEST_STATE_DIR</key><string>%s/state</string><key>OMO_XPC_TEST_SERVICE</key><string>%s</string></dict>\n' "$work" "$service"
    printf '<key>MachServices</key><dict><key>%s</key><true/></dict>\n' "$service"
    printf '<key>StandardOutPath</key><string>%s/ready</string>\n' "$work"
    printf '<key>StandardErrorPath</key><string>%s/stderr</string>\n' "$work"
    printf '%s\n' '<key>RunAtLoad</key><true/>' '<key>LimitLoadToSessionType</key><string>Aqua</string>' '</dict></plist>'
} > "$work/agent.plist"
ready() {
    local expected="$1" line
    while IFS= read -r -t 30 line <&3; do
        case "$line" in
            "XPC_TEST_READY stopped="*)
                printf '%s\n' "$line"
                if [[ "$line" != "XPC_TEST_READY stopped=$expected" ]]; then
                    echo "ASSERT startup stopped expected=$expected actual=${line##*=}"
                    return 1
                fi
                return 0 ;;
        esac
    done
    echo "FAIL no agent startup event"
    return 1
}
# given: no marker, no client connected yet.
launchctl bootstrap "$domain" "$work/agent.plist"
ready false
"$work/client.app/Contents/MacOS/fixture" latch-stop "$service"
# when: SIGKILL prevents destructors or a graceful-shutdown write.
launchctl kill SIGKILL "$domain/$label"
echo "AGENT_SIGKILL sent"
launchctl bootout "$domain/$label"
launchctl bootstrap "$domain" "$work/agent.plist"
# then: restored before a new connection, and still stopped after it.
ready true
echo "LATCH_BEFORE_NEW_CLIENT stopped=true"
"$work/client.app/Contents/MacOS/fixture" latch-check "$service"
echo "SUMMARY durable latch restart cases=1 failed=0"
