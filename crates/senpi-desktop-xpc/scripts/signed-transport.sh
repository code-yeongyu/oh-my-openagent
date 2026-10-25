#!/bin/bash
# Manual O2 proof using real O1 verification and an isolated launchd registration.
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "macOS required" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../../.." && pwd)"
export TMPDIR=/tmp/cu10207
export PATH="$HOME/.rustup/toolchains/1.99.0-aarch64-apple-darwin/bin:$PATH"
mkdir -p "$TMPDIR"
work="$(mktemp -d "$TMPDIR/o2-proof.XXXXXX")"
suffix="${work##*.}"
domain="gui/$(id -u)"
service="ai.sisyphuslabs.o2proof.$suffix"
real_label="$service.real"
squat_label="$service.squatter"
identity='Developer ID Application: Yeongyu Kim (523JNR86LZ)'
client_pid=""

cleanup() {
    status=$?
    trap - EXIT INT TERM
    if [[ -n "$client_pid" ]]; then
        kill "$client_pid" 2>/dev/null || true
        wait "$client_pid" 2>/dev/null || true
    fi
    for label in "$real_label" "$squat_label"; do
        launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
        if launchctl print "$domain/$label" >/dev/null 2>&1; then
            echo "CLEANUP FAILED job remains: $label"
            status=1
        else
            echo "CLEANUP job REMOVED: $label"
        fi
    done
    if [[ "$status" != 0 ]]; then
        for log in "$work/client.stderr" "$work/$real_label.stderr" "$work/$squat_label.stderr"; do
            if [[ -f "$log" ]]; then
                while IFS= read -r line; do printf 'FIXTURE_LOG %s\n' "$line"; done < "$log"
            fi
        done
    fi
    if pgrep -f "$work/" >/dev/null; then
        echo "CLEANUP FAILED fixture processes remain"
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
cargo build -p senpi-desktop-engine --bin senpi-desktop-engine
cargo build -p senpi-desktop-xpc --example xpc_fixture

bundle() {
    local name="$1" id="$2" epoch="$3" source="$4"
    local app="$work/$name.app"
    mkdir -p "$app/Contents/MacOS"
    cp "$source" "$app/Contents/MacOS/fixture"
    {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
            '<plist version="1.0"><dict>' \
            '<key>CFBundleExecutable</key><string>fixture</string>' \
            '<key>CFBundlePackageType</key><string>APPL</string>' \
            '<key>CFBundleVersion</key><string>1</string>'
        printf '<key>CFBundleIdentifier</key><string>%s</string>\n' "$id"
        printf '<key>OmODesktopSecurityEpoch</key><string>%s</string>\n' "$epoch"
        printf '%s\n' '</dict></plist>'
    } > "$app/Contents/Info.plist"
    codesign --force --sign "$identity" --timestamp=none --options runtime,hard,kill "$app"
    codesign --verify --strict "$app"
}

bundle agent ai.sisyphuslabs.senpi-desktop-engine.xpc-v1 xpc-1 target/debug/senpi-desktop-engine
bundle client ai.sisyphuslabs.senpi-desktop-controller.xpc-v1 xpc-1 target/debug/examples/xpc_fixture
bundle old ai.sisyphuslabs.senpi-desktop-controller.xpc-v1 xpc-0 target/debug/examples/xpc_fixture
bundle untrusted ai.sisyphuslabs.o2-untrusted xpc-1 target/debug/examples/xpc_fixture
client="$work/client.app/Contents/MacOS/fixture"
untrusted="$work/untrusted.app/Contents/MacOS/fixture"

job() {
    local label="$1" binary="$2" mode="$3"
    {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>'
        printf '<key>Label</key><string>%s</string>\n' "$label"
        printf '<key>ProgramArguments</key><array><string>%s</string><string>%s</string><string>%s</string></array>\n' \
            "$binary" "$mode" "$service"
        printf '<key>MachServices</key><dict><key>%s</key><true/></dict>\n' "$service"
        printf '<key>StandardOutPath</key><string>%s/%s.stdout</string>\n' "$work" "$label"
        printf '<key>StandardErrorPath</key><string>%s/%s.stderr</string>\n' "$work" "$label"
        printf '%s\n' '<key>LimitLoadToSessionType</key><string>Aqua</string>' '</dict></plist>'
    } > "$work/$label.plist"
}

job "$real_label" "$work/agent.app/Contents/MacOS/fixture" --xpc-agent
job "$squat_label" "$untrusted" squatter
launchctl bootstrap "$domain" "$work/$real_label.plist"
"$client" valid "$service"
echo "CASE valid requester PASS"
"$untrusted" reject "$service"
echo "CASE unauthorized requester PASS"
"$work/old.app/Contents/MacOS/fixture" reject "$service"
echo "CASE old security epoch PASS"

mkfifo "$work/input" "$work/output"
exec 3<> "$work/input"
exec 4<> "$work/output"
"$client" restart "$service" < "$work/input" > "$work/output" 2> "$work/client.stderr" &
client_pid=$!
marker() {
    local expected="$1" line
    while IFS= read -r -t 20 line <&4; do
        printf '%s\n' "$line"
        [[ "$line" == "$expected" ]] && return 0
    done
    echo "missing fixture signal: $expected" >&2
    return 1
}
marker READY_FOR_REPLACEMENT
launchctl bootout "$domain/$real_label"
launchctl bootstrap "$domain" "$work/$squat_label.plist"
printf 'squatter ready\n' >&3
marker SQUATTER_REFUSED
grep -q 'SQUATTER public_only=true fields=2' "$work/$squat_label.stdout"
if grep -Eq 'public_only=false|private-rpc-canary|SQUATTER_FAILED' "$work/$squat_label.stdout"; then
    echo "squatter received nonpublic traffic" >&2
    exit 1
fi
echo "CASE name squatter public discovery only PASS"
launchctl bootout "$domain/$squat_label"
launchctl bootstrap "$domain" "$work/$real_label.plist"
printf 'real server restored\n' >&3
marker STALE_CAPABILITY_REFUSED
wait "$client_pid"
client_pid=""
exec 3>&-
exec 4>&-
echo "CASE old endpoint invalidation and no replay PASS"
echo "CASE restart fresh reconnect and stale capability PASS"
bash "$root/crates/senpi-desktop-xpc/scripts/signed-crash.sh"
echo "SUMMARY signed transport cases=7 unexpected=0"
