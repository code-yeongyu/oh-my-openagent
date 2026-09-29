#!/usr/bin/env bash
# Signs Darwin release executables with the Developer ID Application certificate
# (hardened runtime, secure timestamp, stable identifier), notarizes them in one
# notarytool submission, and verifies the result the way Gatekeeper will.
#
#   macos-sign-and-notarize.sh --identifier <id> [--entitlements <plist>] <file>...
#
# Signing material comes from the environment (GitHub Actions secrets):
#   CSC_LINK          base64 of the Developer ID Application .p12
#   CSC_KEY_PASSWORD  password of that .p12
#   APPLE_API_KEY     contents of the App Store Connect API key (.p8)
#   APPLE_API_KEY_ID  its key ID
#   APPLE_API_ISSUER  its issuer ID
# MACOS_SIGNING_REQUIRED=true turns missing material into a failure. Otherwise the
# files are ad-hoc signed with the same identifier, which keeps every signature
# valid (a cross-compiled Bun executable otherwise carries Bun's invalidated one).
# Bare Mach-O files cannot be stapled; Gatekeeper fetches the ticket online.
set -euo pipefail

identifier=""
entitlements=""
files=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --identifier) identifier="${2:?--identifier needs a value}"; shift 2 ;;
    --entitlements) entitlements="${2:?--entitlements needs a value}"; shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) files+=("$1"); shift ;;
  esac
done
if [ -z "$identifier" ] || [ "${#files[@]}" -eq 0 ]; then
  echo "usage: $0 --identifier <id> [--entitlements <plist>] <file>..." >&2
  exit 2
fi
for file in "${files[@]}"; do
  [ -f "$file" ] || { echo "not a file: $file" >&2; exit 2; }
done
if [ -n "$entitlements" ] && [ ! -f "$entitlements" ]; then
  echo "entitlements file not found: $entitlements" >&2
  exit 2
fi

material=(CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER)
missing=()
for name in "${material[@]}"; do
  [ -n "${!name:-}" ] || missing+=("$name")
done

if [ "${#missing[@]}" -gt 0 ]; then
  if [ "${MACOS_SIGNING_REQUIRED:-false}" = "true" ]; then
    echo "::error::MACOS_SIGNING_REQUIRED is true but signing material is missing: ${missing[*]}" >&2
    exit 1
  fi
  echo "::warning::Developer ID signing material is not configured (${missing[*]}); ad-hoc signing ${#files[@]} file(s) as ${identifier}. These binaries are not notarized and Gatekeeper rejects quarantined copies." >&2
  for file in "${files[@]}"; do
    codesign --force --sign - --identifier "$identifier" "$file"
    codesign --verify --strict --verbose=2 "$file"
  done
  exit 0
fi

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/macos-signing.XXXXXX")"
keychain="$work/signing.keychain-db"
original_keychains=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%\"}"
  original_keychains+=("${line#\"}")
done < <(security list-keychains -d user)

cleanup() {
  if [ "${#original_keychains[@]}" -gt 0 ]; then
    security list-keychains -d user -s "${original_keychains[@]}" || true
  fi
  security delete-keychain "$keychain" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
printf '%s' "$CSC_LINK" | base64 --decode > "$work/certificate.p12"
security import "$work/certificate.p12" -k "$keychain" -P "$CSC_KEY_PASSWORD" -f pkcs12 -T /usr/bin/codesign >/dev/null
rm -f "$work/certificate.p12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"

identity="$(security find-identity -v -p codesigning "$keychain" | awk '/"Developer ID Application: / { print $2; exit }')"
if [ -z "$identity" ]; then
  echo "::error::the imported certificate is not a valid Developer ID Application identity" >&2
  exit 1
fi
team="$(security find-identity -v -p codesigning "$keychain" | sed -n 's/.*"Developer ID Application: .* (\([A-Z0-9]*\))".*/\1/p' | head -n 1)"

sign_args=(--force --options runtime --timestamp --identifier "$identifier" --keychain "$keychain" --sign "$identity")
if [ -n "$entitlements" ]; then
  sign_args+=(--entitlements "$entitlements")
fi
for file in "${files[@]}"; do
  codesign "${sign_args[@]}" "$file"
  codesign --verify --strict --verbose=2 "$file"
  details="$(codesign -dv --verbose=2 "$file" 2>&1)"
  grep -q "TeamIdentifier=${team}" <<<"$details" || { echo "::error::${file} is not signed by team ${team}" >&2; exit 1; }
  grep -q "flags=0x10000(runtime)" <<<"$details" || { echo "::error::${file} lacks the hardened runtime" >&2; exit 1; }
done

key_file="$work/AuthKey_${APPLE_API_KEY_ID}.p8"
printf '%s' "$APPLE_API_KEY" > "$key_file"
notary=(--key "$key_file" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
archive="$work/notarize.zip"
mkdir "$work/payload"
cp "${files[@]}" "$work/payload/"
ditto -c -k --keepParent "$work/payload" "$archive"
result="$(xcrun notarytool submit "$archive" "${notary[@]}" --wait --timeout 1h --output-format json)"
submission="$(jq -r '.id // empty' <<<"$result")"
status="$(jq -r '.status // empty' <<<"$result")"
echo "notarization ${submission:-<none>}: ${status:-<none>}"
if [ "$status" != "Accepted" ]; then
  if [ -n "$submission" ]; then
    xcrun notarytool log "$submission" "${notary[@]}" || true
  fi
  echo "::error::notarization was not accepted (status: ${status:-unknown})" >&2
  exit 1
fi

for file in "${files[@]}"; do
  assessment="$(spctl --assess -vvv --type open --context context:primary-signature "$file" 2>&1 || true)"
  echo "$assessment"
  grep -q "source=Notarized Developer ID" <<<"$assessment" || {
    echo "::error::Gatekeeper does not accept ${file} as notarized" >&2
    exit 1
  }
done
