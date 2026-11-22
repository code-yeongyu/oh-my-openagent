#!/usr/bin/env bash
# Operator build of the darwin release artifacts (#13921). publish.yml's `operator_darwin_artifacts` input
# replaces the hosted macOS legs of publish-platform.yml with the output of this script. Run it on a maintainer
# Mac from any checkout. It builds the given source sha in a fresh worktree and replays, step by step:
#   desktop-engine darwin-arm64/x64 (capture helper, engine, engine trust helper),
#   keychain-helper,
#   build darwin-arm64/x64/x64-baseline.
# It signs and notarizes through .github/scripts/macos-sign-and-notarize.sh from that same sha, as CI does.
# Each engine carries a signed `__OMO_META,__build` section {source_sha, host, rust_target, version}, which
# .github/workflows/operator-darwin-verify.ts checks on Linux before anything is published.
#
#   script/darwin-operator-build.sh <source sha (40 hex)> <version> <evidence dir> [--upload]
#
# Signing material: the signing script reads CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY, APPLE_API_KEY_ID and
# APPLE_API_ISSUER from its environment. Each call imports the .p12 into its own scratch keychain under the run
# TMPDIR and deletes that keychain on exit. This script fills those variables from the 0600 files in
# $OMO_SIGNING_DIR (default ~/.config/sisyphuslabs-signing: developer-id-application.p12, p12-password,
# AuthKey_<id>.p8) and from $APPLE_API_ISSUER, inside the signing subshell only. Nothing secret is echoed.
# --upload creates the draft release operator-darwin-<sha12> and uploads the artifacts, their .sha256 files
# and operator-darwin-manifest.json. Without --upload the artifacts stay staged under <evidence dir>.
set -euo pipefail

SHA="${1:?usage: darwin-operator-build.sh <40-hex sha> <version> <evidence dir> [--upload]}"
VERSION="${2:?usage: darwin-operator-build.sh <40-hex sha> <version> <evidence dir> [--upload]}"
RUN_DIR="${3:?usage: darwin-operator-build.sh <40-hex sha> <version> <evidence dir> [--upload]}"
UPLOAD="${4:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "sha must be 40 lowercase hex" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "invalid version: $VERSION" >&2; exit 2; }
[ -z "$UPLOAD" ] || [ "$UPLOAD" = --upload ] || { echo "unknown option: $UPLOAD" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "darwin artifacts are built on macOS" >&2; exit 2; }
: "${APPLE_API_ISSUER:?set APPLE_API_ISSUER to the App Store Connect issuer id (public)}"

mkdir -p "$RUN_DIR"
LOG="$RUN_DIR/OPERATOR-LOG.md"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
SIGNING_DIR="${OMO_SIGNING_DIR:-$HOME/.config/sisyphuslabs-signing}"
API_KEY_FILE="$(find "$SIGNING_DIR" -maxdepth 1 -name 'AuthKey_*.p8' | head -n 1)"
[ -n "$API_KEY_FILE" ] || { echo "no AuthKey_<id>.p8 in $SIGNING_DIR" >&2; exit 2; }
OUT="$RUN_DIR/artifacts-${SHA:0:12}"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
RUN_TMP="$(mktemp -d "/tmp/darwin-operator.XXXXXX")"
export TMPDIR="$RUN_TMP" NODE_COMPILE_CACHE="$RUN_TMP/node-compile-cache" BUN_RUNTIME_TRANSPILER_CACHE_PATH="$RUN_TMP/bun-transpiler"
SRC="$RUN_TMP/src"
cleanup() {
  git -C "$REPO" worktree remove --force "$SRC" 2>/dev/null || true
  rm -rf "$RUN_TMP"
}
trap cleanup EXIT

log() { printf -- '- `%s` %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
step() {
  # step <description> -- <command...>; logs the exact command, the result and the duration.
  local desc="$1"; shift; [ "$1" = "--" ] && shift
  local t0; t0=$(date +%s)
  log "START ${desc}: \`$*\`"
  if "$@" >>"$RUN_DIR/operator-run.out" 2>&1; then
    log "OK ${desc} ($(( $(date +%s) - t0 ))s)"
  else
    local rc=$?
    log "FAIL ${desc} rc=${rc} ($(( $(date +%s) - t0 ))s); tail of operator-run.out follows"
    tail -n 30 "$RUN_DIR/operator-run.out" | sed 's/^/    /' >>"$LOG"
    exit "$rc"
  fi
}
sha_line() { log "sha256 $(basename "$1") $(shasum -a 256 "$1" | awk '{print $1}') ($(wc -c <"$1" | tr -d ' ') bytes)"; }

# The signing script reads CSC_LINK/CSC_KEY_PASSWORD/APPLE_API_* from its environment,
# creates a scratch keychain under $TMPDIR, imports the .p12 there, restores the user
# keychain search list and deletes the scratch keychain on exit. The login keychain is
# never written. The values exist only in this subshell's environment.
sign() {
  (
    CSC_LINK="$(base64 -i "$SIGNING_DIR/developer-id-application.p12" | tr -d '\n')"
    CSC_KEY_PASSWORD="$(tr -d '\n' <"$SIGNING_DIR/p12-password")"
    APPLE_API_KEY="$(cat "$API_KEY_FILE")"
    APPLE_API_KEY_ID="$(basename "$API_KEY_FILE" .p8)"; APPLE_API_KEY_ID="${APPLE_API_KEY_ID#AuthKey_}"
    MACOS_SIGNING_REQUIRED=true
    RUNNER_TEMP="$RUN_TMP"
    export CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER MACOS_SIGNING_REQUIRED RUNNER_TEMP
    cd "$SRC"
    bash .github/scripts/macos-sign-and-notarize.sh "$@"
  )
}
notary_ids() { grep -Eo 'notarization [0-9a-f-]{36}: [A-Za-z ]+' "$RUN_DIR/operator-run.out" | sort -u | while read -r l; do log "notary ${l#notarization }"; done; }

mkdir -p "$OUT"
: >"$RUN_DIR/operator-run.out"
OPERATOR="$(gh api user --jq .login)"
log "RUN begin sha=${SHA} version=${VERSION} hw=$(sysctl -n hw.model) operator=${OPERATOR} run_tmp=${RUN_TMP}"
log "keychains before: $(security list-keychains -d user | tr -d ' "' | xargs -n1 basename | tr '\n' ' ')"

# --- source at the exact sha, clean ---
step "worktree at ${SHA}" -- git -C "$REPO" worktree add --detach "$SRC" "$SHA"
[ "$(git -C "$SRC" rev-parse HEAD)" = "$SHA" ] || { log "FAIL HEAD != sha"; exit 1; }
[ -z "$(git -C "$SRC" status --porcelain)" ] || { log "FAIL worktree dirty"; exit 1; }
cd "$SRC"
TOOLCHAIN="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml)"
step "rust toolchain ${TOOLCHAIN}" -- rustup toolchain install "$TOOLCHAIN" --profile minimal
step "rust targets" -- rustup target add --toolchain "$TOOLCHAIN" aarch64-apple-darwin x86_64-apple-darwin
export RUSTUP_TOOLCHAIN="$TOOLCHAIN"
log "toolchain $(rustc --version) / $(cargo --version) / bun $(bun --version) / $(/usr/bin/clang --version | head -n1)"
step "bun install" -- bun install --frozen-lockfile --ignore-scripts

rt_of() { case "$1" in darwin-arm64) echo aarch64-apple-darwin ;; darwin-x64) echo x86_64-apple-darwin ;; esac; }
ca_of() { case "$1" in darwin-arm64) echo arm64 ;; darwin-x64) echo x86_64 ;; esac; }

# --- capture helpers (publish-platform: "Build and sign Darwin capture helper") ---
for host in darwin-arm64 darwin-x64; do
  d="$RUN_TMP/capture-helper-$host"; mkdir -p "$d"
  step "capture helper clang ${host}" -- /usr/bin/clang -arch "$(ca_of "$host")" -x objective-c -std=c11 -fobjc-arc -O2 -Wall \
    -mmacosx-version-min=13.0 -framework AppKit -framework ScreenCaptureKit -framework CoreVideo \
    crates/senpi-desktop-backend-macos/native/senpi-desktop-capture-helper.m -o "$d/senpi-desktop-capture-helper"
done
step "sign (sign-only) capture helpers" -- sign --sign-only --identifier ai.sisyphuslabs.senpi-desktop-engine \
  "$RUN_TMP/capture-helper-darwin-arm64/senpi-desktop-capture-helper" "$RUN_TMP/capture-helper-darwin-x64/senpi-desktop-capture-helper"

# --- engines with the signed source binding (__OMO_META,__build) ---
for host in darwin-arm64 darwin-x64; do
  rt="$(rt_of "$host")"
  meta="$RUN_TMP/omo-meta-$host.json"
  printf '{"schema":"omo-darwin-operator-build/1","source_sha":"%s","rust_target":"%s","host":"%s","version":"%s","toolchain":"%s"}' \
    "$SHA" "$rt" "$host" "$VERSION" "$TOOLCHAIN" >"$meta"
  step "engine cargo ${host}" -- env MACOSX_DEPLOYMENT_TARGET=11.0 SENPI_DESKTOP_CAPTURE_HELPER_SIGNED="$RUN_TMP/capture-helper-$host" \
    cargo rustc --release -p senpi-desktop-engine --bin senpi-desktop-engine --locked --target "$rt" \
    -- -C "link-arg=-Wl,-sectcreate,__OMO_META,__build,$meta"
  step "engine stage ${host}" -- bun script/desktop-engine-release.ts stage "$host" "target/$rt/release/senpi-desktop-engine" .omo/desktop-engine-assets
  if [ "$host" = darwin-x64 ]; then step "engine selftest ${host} (rosetta)" -- arch -x86_64 "target/$rt/release/senpi-desktop-engine" --selftest
  else step "engine selftest ${host}" -- "target/$rt/release/senpi-desktop-engine" --selftest; fi
  # engine trust helper (publish-platform: "Build engine trust helper")
  step "trust helper cargo ${host}" -- env MACOSX_DEPLOYMENT_TARGET=11.0 cargo build --release -p omo-engine-trust-helper --locked --target "$rt"
  mkdir -p ".omo/desktop-engine-assets/engine-trust-helper-$host"
  cp "target/$rt/release/omo-engine-trust-helper" ".omo/desktop-engine-assets/engine-trust-helper-$host/"
  chmod 755 ".omo/desktop-engine-assets/engine-trust-helper-$host/omo-engine-trust-helper"
done
step "sign (sign-only) trust helpers" -- sign --sign-only --identifier ai.sisyphuslabs.omo-engine-trust-helper \
  .omo/desktop-engine-assets/engine-trust-helper-darwin-arm64/omo-engine-trust-helper .omo/desktop-engine-assets/engine-trust-helper-darwin-x64/omo-engine-trust-helper
step "trust helper smoke darwin-arm64" -- bash -c '.omo/desktop-engine-assets/engine-trust-helper-darwin-arm64/omo-engine-trust-helper </dev/null | bun script/engine-trust-helper-smoke.ts'
step "trust helper smoke darwin-x64 (rosetta)" -- bash -c 'arch -x86_64 .omo/desktop-engine-assets/engine-trust-helper-darwin-x64/omo-engine-trust-helper </dev/null | bun script/engine-trust-helper-smoke.ts'

# --- keychain helper (publish-platform: keychain-helper) ---
step "keychain helper build" -- bun packages/omo-native/keychain-helper/build.ts --out "$RUN_TMP/omo-keychain/omo-keychain"

# --- notarize batch 1: engines + keychain helper ---
step "sign+notarize engines" -- sign --identifier ai.sisyphuslabs.senpi-desktop-engine \
  .omo/desktop-engine-assets/senpi-desktop-engine-darwin-arm64 .omo/desktop-engine-assets/senpi-desktop-engine-darwin-x64
notary_ids
step "engine selftest signed darwin-arm64" -- .omo/desktop-engine-assets/senpi-desktop-engine-darwin-arm64 --selftest
step "engine selftest signed darwin-x64 (rosetta)" -- arch -x86_64 .omo/desktop-engine-assets/senpi-desktop-engine-darwin-x64 --selftest
step "sign+notarize keychain helper" -- sign --identifier com.mengmota.omo-keychain-helper "$RUN_TMP/omo-keychain/omo-keychain"
notary_ids
step "keychain helper verify" -- bun script/keychain-helper-release.ts verify "$RUN_TMP/omo-keychain/omo-keychain"
chmod 0755 "$RUN_TMP/omo-keychain/omo-keychain"
mkdir -p packages/omo-native/bin/darwin
install -m 0755 "$RUN_TMP/omo-keychain/omo-keychain" packages/omo-native/bin/darwin/omo-keychain

# --- omo release binaries (publish-platform: build darwin legs) ---
for platform in darwin-arm64 darwin-x64 darwin-x64-baseline; do
  for kind in "" --trust-helper-target; do
    info="$(bun script/release-desktop-engine-target.ts ${kind:-"--target"} "$platform")"
    asset="$(jq -r '.asset // empty' <<<"$info")"; source="$(jq -r '.source // empty' <<<"$info")"
    [ -n "$asset" ] || continue
    test -f ".omo/desktop-engine-assets/$asset"
    mkdir -p "$(dirname "$source")"; cp ".omo/desktop-engine-assets/$asset" "$source"; chmod +x "$source"
    log "staged $asset -> $source for $platform"
  done
  step "omo binary ${platform}" -- bun run script/build-omo-binary.ts --target "$platform" --omo-version "$VERSION" --omo-ai-version "$VERSION"
done
step "sign+notarize omo binaries" -- sign --identifier ai.sisyphuslabs.omo --entitlements .github/scripts/omo-bun-executable.entitlements \
  .omo/release-binaries/omo-darwin-arm64 .omo/release-binaries/omo-darwin-x64 .omo/release-binaries/omo-darwin-x64-baseline
notary_ids
ENGINE_PIN="$(jq -r '.dependencies["@code-yeongyu/senpi"]' packages/omo-native/package.json)"
step "omo darwin-arm64 version smoke" -- bash -c "H=\$(mktemp -d); HOME=\$H/home OMO_CODING_AGENT_DIR=\$H/agent; mkdir -p \$HOME; export HOME OMO_CODING_AGENT_DIR; .omo/release-binaries/omo-darwin-arm64 --version | grep -F 'omo ${VERSION} (engine: senpi ${ENGINE_PIN}'"
step "omo darwin-x64 version smoke (rosetta)" -- bash -c "H=\$(mktemp -d); HOME=\$H/home OMO_CODING_AGENT_DIR=\$H/agent; mkdir -p \$HOME; export HOME OMO_CODING_AGENT_DIR; arch -x86_64 .omo/release-binaries/omo-darwin-x64 --version | grep -F 'omo ${VERSION} (engine: senpi ${ENGINE_PIN}'"

# --- collect + local verification (informational, self-attested) ---
cp .omo/desktop-engine-assets/senpi-desktop-engine-darwin-arm64 .omo/desktop-engine-assets/senpi-desktop-engine-darwin-x64 "$OUT/"
for host in darwin-arm64 darwin-x64; do cp .omo/desktop-engine-assets/engine-trust-helper-$host/omo-engine-trust-helper "$OUT/omo-engine-trust-helper-$host"; done
cp "$RUN_TMP/omo-keychain/omo-keychain" "$OUT/omo-keychain-darwin-universal"
cp .omo/release-binaries/omo-darwin-arm64 .omo/release-binaries/omo-darwin-x64 .omo/release-binaries/omo-darwin-x64-baseline "$OUT/"
cd "$OUT"
for f in *; do
  case "$f" in *.sha256|*.json|*.txt) continue ;; esac
  shasum -a 256 "$f" >"$f.sha256"
  sha_line "$OUT/$f"
  codesign --verify --strict "$f" >>"$RUN_DIR/operator-run.out" 2>&1 && log "codesign --verify --strict $f: ok" || log "codesign --verify --strict $f: FAIL"
  log "$f $(codesign -dv --verbose=2 "$f" 2>&1 | grep -E '^(Identifier|TeamIdentifier|CDHash)=' | tr '\n' ' ')"
  case "$f" in omo-engine-trust-helper-*) ;; *) log "$f spctl: $(spctl -a -vv -t install "$f" 2>&1 | grep -E 'accepted|rejected|source=' | tr '\n' ' ')" ;; esac
done
bun -e '
const fs = require("node:fs"), crypto = require("node:crypto")
const [sha, version, operator, runLog] = process.argv.slice(1)
// Audit record only (#13943 LOW-1): the publish run trusts the Apple ticket lookup by cdhash, not these ids.
const notarySubmissions = [...new Set(fs.readFileSync(runLog, "utf8").match(/notarization [0-9a-f-]{36}: Accepted/g) ?? [])].map((line) => line.split(" ")[1].slice(0, -1))
const sha256 = {}
for (const name of fs.readdirSync(".").filter((n) => !n.endsWith(".sha256") && !n.endsWith(".json")))
  sha256[name] = crypto.createHash("sha256").update(fs.readFileSync(name)).digest("hex")
fs.writeFileSync("operator-darwin-manifest.json", JSON.stringify({ schema: "omo-darwin-operator-manifest/1", source_sha: sha, version, operator, built_at: new Date().toISOString(), notary_submissions: notarySubmissions, sha256 }, null, 2) + "\n")
' "$SHA" "$VERSION" "$OPERATOR" "$RUN_DIR/operator-run.out"
sha_line "$OUT/operator-darwin-manifest.json"
log "keychains after: $(security list-keychains -d user | tr -d ' "' | xargs -n1 basename | tr '\n' ' ')"
if [ "$UPLOAD" = --upload ]; then
  TAG="operator-darwin-${SHA:0:12}"
  step "draft release ${TAG}" -- gh release create "$TAG" --repo code-yeongyu/oh-my-openagent --draft --target "$SHA" \
    --title "$TAG (operator-built darwin artifacts, staging)" --notes "Operator-built darwin artifacts for ${VERSION} from ${SHA}. Consumed by publish.yml operator_darwin_artifacts; not a release."
  step "upload ${TAG}" -- gh release upload "$TAG" --repo code-yeongyu/oh-my-openagent "$OUT"/*
  log "RUN uploaded to draft ${TAG}"
else
  log "RUN staged in ${OUT} (NOT uploaded)"
fi
