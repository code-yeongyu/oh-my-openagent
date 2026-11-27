#!/bin/bash
# macOS-only manual acceptance proof, NOT a CI test. Requires the local
# Developer ID Application identity below and an unlocked signing keychain.
# Run from any directory:
#   TMPDIR=/tmp/cu10207 bash crates/senpi-desktop-xpc/scripts/signed-fixtures.sh
#
# Builds only verify_self, embeds a signature-covered Info.plist with linker
# -sectcreate, signs task-owned copies, and runs each as its own live peer.
# This does not notarize, register services, request TCC, or change production.
# Diagnostic live status is printed independently; only the real verifier's
# Result determines PASS. Never add hard/kill to hide a runtime-only failure.
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo "macOS required" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../../.." && pwd)"
identity='Developer ID Application: Yeongyu Kim (523JNR86LZ)'
engine_id='ai.sisyphuslabs.senpi-desktop-engine.xpc-v1'
export TMPDIR="${TMPDIR:-/tmp/cu10207}"
mkdir -p "$TMPDIR"
work="$(mktemp -d "$TMPDIR/o1-signed.XXXXXX")"
cleanup() {
    rm -rf "$work"
    if [[ ! -e "$work" ]]; then echo "CLEANUP fixture directory REMOVED"; fi
}
trap cleanup EXIT
export CARGO_TARGET_DIR="$work/target"
cd "$root"

build() {
    local name="$1" epoch="$2" plist="$work/$1.plist"
    {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
            '<plist version="1.0"><dict>'
        printf '<key>CFBundleIdentifier</key><string>%s</string>\n' "$engine_id"
        if [[ -n "$epoch" ]]; then
            printf '<key>OmODesktopSecurityEpoch</key><string>%s</string>\n' "$epoch"
        fi
        printf '%s\n' '</dict></plist>'
    } > "$plist"
    cargo rustc -p senpi-desktop-xpc --example verify_self -- \
        -C "link-arg=-Wl,-sectcreate,__TEXT,__info_plist,$plist"
    cp "$CARGO_TARGET_DIR/debug/examples/verify_self" "$work/$name"
}

entitlement() {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
        '<plist version="1.0"><dict>' \
        "<key>$2</key><true/>" '</dict></plist>' > "$work/$1.plist"
}

sign() {
    local name="$1" source="$2" identifier="$3"
    shift 3
    cp "$work/$source" "$work/$name"
    codesign --force --sign "$identity" --timestamp=none --identifier "$identifier" "$@" "$work/$name"
}

build normal xpc-1
build missing ""
build stale xpc-0
entitlement task-allow com.apple.security.get-task-allow
entitlement library-validation com.apple.security.cs.disable-library-validation
entitlement page-protection com.apple.security.cs.disable-executable-page-protection
sign accept normal "$engine_id" --options runtime
sign no-runtime normal "$engine_id"
sign task-allow normal "$engine_id" --options runtime --entitlements "$work/task-allow.plist"
sign library-validation normal "$engine_id" --options runtime --entitlements "$work/library-validation.plist"
sign page-protection normal "$engine_id" --options runtime --entitlements "$work/page-protection.plist"
sign wrong-identifier normal ai.sisyphuslabs.untrusted --options runtime
sign missing-epoch missing "$engine_id" --options runtime
sign stale-epoch stale "$engine_id" --options runtime
cp "$work/normal" "$work/ad-hoc"
codesign --force --sign - --identifier "$engine_id" --options runtime "$work/ad-hoc"

failures=0
check() {
    local name="$1" expected="$2" role="${3:-engine}" output verdict result
    output="$("$work/$name" "$role")"
    verdict="$(printf '%s\n' "$output" | /usr/bin/sed -n 's/^verdict=//p')"
    result=FAIL
    if [[ "$expected" == ACCEPT && "$verdict" == Ok\(* ]]; then
        result=PASS
    elif [[ "$verdict" == "Err($expected)" ]]; then
        result=PASS
    else
        failures=$((failures + 1))
    fi
    printf 'CASE %s role=%s expected=%s %s\n%s\n' "$name" "$role" "$expected" "$result" "$output"
}

check accept ACCEPT
check no-runtime MissingHardening
check task-allow ForbiddenEntitlement
check library-validation ForbiddenEntitlement
# On macOS, this entitlement clears live CS_HARD (observed 0x22010211).
# Hardening is checked first, so this signed case must fail there. The pure
# policy row independently proves the entitlement itself is forbidden too.
check page-protection MissingHardening
check wrong-identifier RequirementRejected
check missing-epoch MissingSecurityEpoch
check stale-epoch StaleSecurityEpoch
check ad-hoc RequirementRejected
check accept RequirementRejected controller
printf 'SUMMARY cases=10 unexpected=%s\n' "$failures"
[[ "$failures" == 0 ]]
