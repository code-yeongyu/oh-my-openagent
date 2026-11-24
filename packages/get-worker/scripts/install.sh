#!/bin/sh
# Keep this wrapper POSIX-sh parseable: the Bash program is data until Bash reads the temp file.
omo_sourced=
if [ -n "${BASH_VERSION:-}" ] && eval '[ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "$0" ]'; then omo_sourced=1; fi
omo_bash="$(command -v bash 2>/dev/null || true)"
if [ -z "$omo_bash" ]; then
  printf '%s\n' 'omo installer: bash is required; run with: curl -fsSL https://get.omo.dev/install.sh | bash' >&2
  exit 1
fi
omo_bash_script="$(mktemp "${TMPDIR:-/tmp}/omo-install-bash.XXXXXX")" || exit 1
trap 'rm -f "$omo_bash_script"' EXIT HUP INT TERM
cat >"$omo_bash_script" <<'OMO_INSTALL_BASH'
#!/usr/bin/env bash
# OmO native installer: curl -fsSL https://get.omo.dev/install.sh | bash [-s -- latest|beta|X.Y.Z]
#   OMO_INSTALL_DIR        launcher directory (default ~/.local/bin)
#   OMO_NO_MODIFY_PATH=1   never edit shell profiles
#   OMO_INSTALL_BASE_URL   mirror base (default https://get.omo.dev); GitHub is the fallback
#   OMO_INSTALL_ALLOW_SUDO=1  allow installing into root's home from sudo/doas (a plain root shell needs no override)
# The whole body runs from main() on the last line, so a truncated download never runs half a script.
set -euo pipefail

REPO="code-yeongyu/oh-my-openagent"
GITHUB_DOWNLOAD="https://github.com/${REPO}/releases/download"
NPM_DIST_TAGS="https://registry.npmjs.org/-/package/omo-ai/dist-tags"
VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'
MARK_BEGIN="# >>> omo installer >>>"
MARK_END="# <<< omo installer <<<"
USER_AGENT="omo-install.sh/1"
[ "${OMO_INSTALL_QA:-}" = 1 ] && USER_AGENT="${USER_AGENT} omo-install-qa" # QA runs stay out of the public count

say() { printf '%s\n' "$*" >&2; }
fail() { say "omo installer: $*"; exit 1; }

fetch() { # fetch <url> <output file|->
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 2 --connect-timeout 15 -A "$USER_AGENT" -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --https-only -U "$USER_AGENT" -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

# >>> omo release signature (#14916) >>>
# Compiled-in release key set and cut-over constant, generated from packages/release-signing/keys/release-keys.json
# by script/installer/generate-installer-keys.ts. Empty values mean release signing is not active yet: nothing is
# verified (no signed releases exist), and installs behave exactly as before. Each pinned line is
# keyid-hex|SPKI-base64 (the single-line base64 of the key's 44-byte SubjectPublicKeyInfo DER).
OMO_RELEASE_KEYS=''
OMO_RELEASE_V_SIGN=''

version_lt() { # version_lt <a> <b>: prints lt when release a sorts before release b
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, va, /[.-]/); split(b, vb, /[.-]/)
    for (i = 1; i <= 3; i++) { if (va[i] + 0 < vb[i] + 0) { print "lt"; exit } if (va[i] + 0 > vb[i] + 0) { print "ge"; exit } }
    print (split(a, ta, "-") > 1 && split(b, tb, "-") < 2) ? "lt" : "ge"
  }'
}

verify_release_signature() { # verify_release_signature <workdir> <version> <explicit-pin 0|1>
  local work="$1" version="$2" explicit="$3"
  local sig="$work/SHA256SUMS.sig"
  [ -n "$OMO_RELEASE_KEYS" ] || return 0
  if [ ! -f "$sig" ]; then
    if [ "$explicit" = 1 ] && [ "$(version_lt "$version" "$OMO_RELEASE_V_SIGN")" = lt ]; then
      say "  release ${version} predates signed releases; continuing without a signature"
      return 0
    fi
    fail "release signature missing (SHA256SUMS.sig); refusing to install. Only an explicitly pinned version older than V_sign may be unsigned"
  fi
  command -v openssl >/dev/null 2>&1 || fail "openssl is required to verify the release signature"
  [ "$(grep -c '' "$sig")" = 4 ] || fail "release signature malformed (line count)"
  sed -n '2p' "$sig" | tr -d '\r\n' | openssl base64 -d -A >"$work/sigblock.bin" 2>/dev/null || fail "release signature malformed (base64)"
  [ "$(wc -c <"$work/sigblock.bin" | tr -d ' ')" = 74 ] || fail "release signature malformed (length)"
  [ "$(head -c 2 "$work/sigblock.bin")" = ED ] || fail "release signature algorithm refused (only ED is accepted)"
  local sigkeyid; sigkeyid="$(tail -c 72 "$work/sigblock.bin" | head -c 8 | od -An -tx1 | tr -d ' \n')"
  tail -c 64 "$work/sigblock.bin" >"$work/sig.bin"
  openssl dgst -blake2b512 -binary "$work/SHA256SUMS" >"$work/digest.bin" 2>/dev/null || fail "this openssl lacks BLAKE2b-512; install openssl >= 1.1.1 to verify omo releases"
  local keyid pem ok=1
  while IFS='|' read -r keyid pem; do
    [ "$keyid" = "$sigkeyid" ] || continue
    printf -- '-----BEGIN PUBLIC KEY-----\n%s\n-----END PUBLIC KEY-----\n' "$pem" >"$work/key.pem"
    if openssl pkeyutl -verify -pubin -inkey "$work/key.pem" -rawin -in "$work/digest.bin" -sigfile "$work/sig.bin" >/dev/null 2>&1; then
      ok=0
      say "  release signature verified (key ${keyid})"
      break
    fi
  done <<EOF
$OMO_RELEASE_KEYS
EOF
  [ "$ok" = 0 ] || fail "release signature invalid; refusing to install (possible tampering)"
}
# <<< omo release signature (#14916) <<<

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | awk '{print $NF}'
  else fail "sha256sum, shasum or openssl is required to verify the download"
  fi
}

is_musl_libc() { # the system libc, not whether a musl loader happens to be installed (#10562)
  # musl's ldd exits 1 after printing its version, which pipefail would turn into a miss.
  case "$(ldd --version 2>&1 || true)" in *[Mm][Uu][Ss][Ll]*) return 0 ;; esac
  # Debian/Ubuntu's optional `musl` package ships /lib/ld-musl-*.so.1 next to glibc,
  # so the loader file only counts when the system libc is not glibc.
  if getconf GNU_LIBC_VERSION >/dev/null 2>&1; then return 1; fi
  [ -f /etc/alpine-release ] || ls /lib/ld-musl-*.so.1 >/dev/null 2>&1
}

detect_asset() {
  local os arch libc="" cpu=""
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*) fail "on Windows run in PowerShell: irm https://get.omo.dev/install.ps1 | iex" ;;
    *) fail "unsupported operating system $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "unsupported architecture $(uname -m)" ;;
  esac
  if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64 # a Rosetta shell on Apple silicon gets the native build
  fi
  if [ "$os" = linux ] && is_musl_libc; then libc="-musl"; fi
  if [ "$arch" = x64 ]; then
    if [ "$os" = linux ] && ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null; then cpu="-baseline"; fi
    if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)" != 1 ]; then cpu="-baseline"; fi
  fi
  printf 'omo-%s-%s%s%s\n' "$os" "$arch" "$libc" "$cpu"
}

resolve_version() { # resolve_version <latest|beta|X.Y.Z> <base url>
  local want="$1" base="$2" got=""
  if [[ "$want" =~ $VERSION_RE ]]; then printf '%s\n' "$want"; return; fi
  got="$(fetch "${base}/channels/${want}" - 2>/dev/null | tr -d '[:space:]' || true)"
  if ! [[ "$got" =~ $VERSION_RE ]]; then
    say "  ${base} did not answer for channel ${want}; asking the npm registry"
    got="$(fetch "$NPM_DIST_TAGS" - 2>/dev/null | tr -d '[:space:]' | sed -n "s/.*\"${want}\":\"\([^\"]*\)\".*/\1/p" || true)"
    got="${got/-0./-}"
  fi
  [[ "$got" =~ $VERSION_RE ]] || fail "could not resolve the ${want} channel (mirror and npm registry both failed)"
  printf '%s\n' "$got"
}

download() { # download <version> <asset> <dest> <base>: mirror first, GitHub release asset second
  if fetch "${4}/v/${1}/${2}" "$3" 2>/dev/null; then return 0; fi
  say "  mirror download of ${2} failed; falling back to GitHub releases"
  fetch "${GITHUB_DOWNLOAD}/v${1}/${2}" "$3" || fail "could not download ${2} ${1} from the mirror or GitHub"
}

profile_file() {
  case "$(basename "${SHELL:-sh}")" in
    zsh) printf '%s\n' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then printf '%s\n' "$HOME/.bash_profile"; else printf '%s\n' "$HOME/.bashrc"; fi ;;
    fish) printf '%s\n' "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/omo.fish" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

ensure_path() { # ensure_path <dir>; prints the edited profile, or nothing
  local dir="$1" profile line tmp
  case ":${PATH}:" in *":${dir}:"*) return 0 ;; esac
  if [ -n "${GITHUB_PATH:-}" ]; then printf '%s\n' "$dir" >>"$GITHUB_PATH"; fi
  [ "${OMO_NO_MODIFY_PATH:-}" = 1 ] && return 0
  profile="$(profile_file)"
  if [[ "$profile" == *.fish ]]; then line="fish_add_path -g \"${dir}\""; else line="export PATH=\"${dir}:\$PATH\""; fi
  mkdir -p "$(dirname "$profile")"
  touch "$profile"
  tmp="$(mktemp "${profile}.omo.XXXXXX")"
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$profile" >"$tmp"
  printf '%s\n%s\n%s\n' "$MARK_BEGIN" "$line" "$MARK_END" >>"$tmp"
  cat "$tmp" >"$profile" && rm -f "$tmp"
  printf '%s\n' "$profile"
}

real_path() { # real_path <path>
  local path="$1" target dir
  if [ -L "$path" ]; then
    target="$(readlink "$path")" || return 1
    case "$target" in
      /*) path="$target" ;;
      *) dir="$(cd "$(dirname "$path")" && pwd -P)" || return 1; path="${dir}/${target}" ;;
    esac
  fi
  dir="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "$dir" "$(basename "$path")"
}

shell_quote() { printf '%q' "$1"; }

classify_other_install() { # classify_other_install <candidate> <prior standalone launcher>; prints kind, target, command
  local candidate="$1" prior="$2" real package_root package_name manager root command
  real="$(real_path "$candidate")" || return 1
  case "$real" in
    */node_modules/omo-ai/*) package_name="omo-ai" ;;
    */node_modules/oh-my-openagent/*) package_name="oh-my-openagent" ;;
    */node_modules/oh-my-opencode/*) package_name="oh-my-opencode" ;;
    *) package_name="" ;;
  esac
  if [ -n "$package_name" ]; then
    package_root="${real%%/node_modules/"${package_name}"/*}/node_modules/${package_name}"
    [ -f "$package_root/package.json" ] || return 1
    grep -Eq '"name"[[:space:]]*:[[:space:]]*"'"${package_name}"'"' "$package_root/package.json" || return 1
    case "$package_root" in
      */install/global/node_modules/${package_name})
        manager="bun"; root="${package_root%/install/global/node_modules/"${package_name}"}"
        command="BUN_INSTALL=$(shell_quote "$root") bun remove -g ${package_name}"
        ;;
      */lib/node_modules/${package_name})
        manager="npm"; root="${package_root%/lib/node_modules/"${package_name}"}"
        command="npm uninstall -g ${package_name} --prefix $(shell_quote "$root")"
        ;;
      *) return 1 ;;
    esac
    printf 'package\t%s\t%s\t%s\t%s\t%s\n' "$candidate" "$real" "$manager" "$root" "$package_name|$command"
    return 0
  fi
  if [ -n "$prior" ] && [ "$candidate" = "$prior" ] && "$candidate" --version 2>/dev/null | grep -Eq '^omo([[:space:]]|$)'; then
    printf 'standalone\t%s\t%s\t-\t-\t%s\n' "$candidate" "$real" "standalone|rm -f -- $(shell_quote "$candidate")"
    return 0
  fi
  return 1
}

find_other_installs() { # find_other_installs <launcher> <output file>
  local launcher="$1" output="$2" prior="" dir candidate seen=""
  if [ -f "$HOME/.omo/install.json" ]; then
    prior="$(sed -n 's/.*"binPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HOME/.omo/install.json" | head -n1)"
  fi
  : >"$output"
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] || dir=.
    candidate="${dir%/}/omo"
    [ -f "$candidate" ] || [ -L "$candidate" ] || continue
    [ "$candidate" = "$launcher" ] && continue
    case "\n$seen" in *"\n$candidate\n"*) continue ;; esac
    seen="${seen}${candidate}\n"
    classify_other_install "$candidate" "$prior" >>"$output" || {
      say ""
      say "Note: ${candidate} is another omo command, but its installation could not be verified, so nothing was removed."
    }
  done
  unset IFS
}

is_interactive() { [ -t 0 ] && [ -t 2 ]; }

remove_detected_install() { # remove_detected_install <record>
  local record="$1" kind candidate real manager root details name command current
  IFS=$'\t' read -r kind candidate real manager root details <<<"$record"
  unset IFS
  name="${details%%|*}"; command="${details#*|}"
  current="$(real_path "$candidate" 2>/dev/null || true)"
  if [ "$current" != "$real" ]; then say "  Removal refused because ${candidate} changed after detection. Remove it with: ${command}"; return 1; fi
  if [ "$kind" = package ]; then
    if [ "$manager" = bun ]; then BUN_INSTALL="$root" bun remove -g "$name" >/dev/null 2>&1 || true
    else npm uninstall -g "$name" --prefix "$root" >/dev/null 2>&1 || true
    fi
  else
    rm -f -- "$candidate" || true
  fi
  if [ -e "$candidate" ] || [ -L "$candidate" ]; then
    say "  Could not remove ${candidate}; the new install still works. Remove the other install with: ${command}"
    return 1
  fi
  say "  Removed the other omo install at ${candidate}."
}

report_other_installs() { # report_other_installs <launcher> <remove flag> <work dir>
  local launcher="$1" remove_flag="$2" work="$3" first record candidate command answer
  find_other_installs "$launcher" "$work/other-installs"
  [ -s "$work/other-installs" ] || return 0
  first="$(command -v omo 2>/dev/null || true)"
  exec 3<&0
  while IFS= read -r record; do
    candidate="$(printf '%s' "$record" | cut -f2)"
    command="$(printf '%s' "$record" | cut -f6- | cut -d'|' -f2-)"
    say ""
    say "Another omo install was found at ${candidate}."
    if [ "$first" = "$candidate" ]; then say "  It currently wins on PATH over ${launcher}."
    else say "  ${launcher} wins on PATH; ${candidate} is not used."; fi
    if [ "$remove_flag" = 1 ]; then remove_detected_install "$record" || true; continue; fi
    if is_interactive; then
      printf 'Remove the other omo install at %s? [y/N] ' "$candidate" >&2
      IFS= read -r answer <&3 || answer=""
      case "$answer" in y | Y | yes | YES | Yes) remove_detected_install "$record" || true ;; *) say "  Kept it. Remove it later with: ${command}" ;; esac
    else
      say "  Nothing was removed in this non-interactive run. Re-run with --remove-other-installs, or run: ${command}"
    fi
  done <"$work/other-installs"
  exec 3<&-
}

write_receipt() { # write_receipt <channel> <version> <asset> <launcher> <profile>
  mkdir -p "$HOME/.omo"
  local tmp
  tmp="$(mktemp "$HOME/.omo/install.json.XXXXXX")"
  printf '{\n  "method": "standalone",\n  "channel": "%s",\n  "version": "%s",\n  "asset": "%s",\n  "binPath": "%s",\n  "profileEdits": [%s],\n  "installedAt": "%s"\n}\n' \
    "$1" "$2" "$3" "$4" "${5:+\"$5\"}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$tmp"
  mv -f "$tmp" "$HOME/.omo/install.json"
}

refuse_sudo_install() { # sudo/doas from a user would install into root's home; a root-only shell (proot-distro, containers) is its own user (#14344)
  local invoker="${SUDO_USER:-${DOAS_USER:-root}}"
  [ "$(id -u)" = 0 ] && [ "$invoker" != root ] && [ "${OMO_INSTALL_ALLOW_SUDO:-}" != 1 ] || return 0
  fail "refusing to install into root's home from sudo/doas started by ${invoker}.
  Run it as ${invoker}: curl -fsSL https://get.omo.dev/install.sh | bash
  To install for root anyway: curl -fsSL https://get.omo.dev/install.sh | OMO_INSTALL_ALLOW_SUDO=1 bash"
}

main() {
  local want="" remove_other_installs=0 arg base="${OMO_INSTALL_BASE_URL:-https://get.omo.dev}"
  for arg in "$@"; do
    case "$arg" in
      --remove-other-installs) remove_other_installs=1 ;;
      latest | beta) [ -z "$want" ] || fail "usage: install.sh [--remove-other-installs] [latest|beta|X.Y.Z]"; want="$arg" ;;
      *)
        if [[ "$arg" =~ $VERSION_RE ]] && [ -z "$want" ]; then want="$arg"
        else fail "usage: install.sh [--remove-other-installs] [latest|beta|X.Y.Z]"
        fi
        ;;
    esac
  done
  want="${want:-latest}"
  base="${base%/}"
  refuse_sudo_install
  [ -n "${HOME:-}" ] || fail "HOME is not set"

  local asset version dir launcher work expected actual profile channel
  asset="$(detect_asset)"
  version="$(resolve_version "$want" "$base")"
  channel="$want"; [[ "$want" =~ $VERSION_RE ]] && channel="pinned"
  dir="${OMO_INSTALL_DIR:-$HOME/.local/bin}"
  launcher="${dir}/omo"
  say "Installing omo ${version} (${asset}) into ${dir}"

  work="$(mktemp -d "${TMPDIR:-/tmp}/omo-install.XXXXXX")"
  # shellcheck disable=SC2064 # expand now: the local is gone when the EXIT trap fires after main returns
  trap "rm -rf '${work}'" EXIT
  download "$version" SHA256SUMS "$work/SHA256SUMS" "$base"
  if [ -n "$OMO_RELEASE_KEYS" ]; then
    fetch "${base}/v/${version}/SHA256SUMS.sig" "$work/SHA256SUMS.sig" 2>/dev/null \
      || fetch "${GITHUB_DOWNLOAD}/v${version}/SHA256SUMS.sig" "$work/SHA256SUMS.sig" 2>/dev/null \
      || rm -f "$work/SHA256SUMS.sig"
  fi
  verify_release_signature "$work" "$version" "$([[ "$want" =~ $VERSION_RE ]] && echo 1 || echo 0)"
  if [ -f "$work/SHA256SUMS.sig" ]; then
    header="$(sed -n '1p' "$work/SHA256SUMS")"
    [[ "$header" == "# omo-release-v1 version="* ]] || fail "SHA256SUMS malformed (missing omo-release-v1 header); refusing to install"
    hversion="${header#* version=}"; hversion="${hversion%% *}"
    [ "$hversion" = "$version" ] || fail "signed release version mismatch (asked ${version}, signature says ${hversion}); refusing to install"
    if [[ "$want" != pinned ]]; then
      hchannel="${header##*channel=}"
      wanted_channel="$([[ "$want" = beta ]] && echo beta || echo stable)"
      [ "$hchannel" = "$wanted_channel" ] || fail "signed release channel mismatch (asked ${wanted_channel}, signature says ${hchannel}); refusing to install"
    fi
    expected="$(awk -v a="$asset" 'NR>1 && $2==a {print $1}' "$work/SHA256SUMS" | head -n1)"
  else
    expected="$(awk -v a="$asset" '$2==a || $2=="*"a {print $1}' "$work/SHA256SUMS" | head -n1)"
  fi
  [ -n "$expected" ] || fail "SHA256SUMS for ${version} has no entry for ${asset}"

  if [ -x "$launcher" ] && [ "$(sha256_of "$launcher")" = "$expected" ]; then
    say "  omo ${version} is already installed at ${launcher}"
  else
    download "$version" "$asset" "$work/omo" "$base"
    actual="$(sha256_of "$work/omo")"
    [ "$actual" = "$expected" ] || fail "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
    say "  checksum verified (sha256 ${expected})"
    chmod +x "$work/omo"
    if [ "$(uname -s)" = Darwin ] && [ -n "$OMO_RELEASE_KEYS" ]; then
      codesign --verify --strict -R='=anchor apple generic and certificate leaf[subject.OU] = "523JNR86LZ"' "$work/omo" 2>/dev/null \
        || fail "the macOS release is not signed by the expected Developer ID; refusing to install"
    fi
    mkdir -p "$dir"
    cp "$work/omo" "${launcher}.new.$$"
    mv -f "${launcher}.new.$$" "$launcher"
  fi

  if [ "${asset#*-musl}" != "$asset" ] && ! ls /usr/lib/libstdc++.so.6 /lib/libstdc++.so.6 >/dev/null 2>&1; then
    say "  musl build needs libstdc++: apk add libstdc++ libgcc"
  fi
  "$launcher" --version >&2 || fail "${launcher} --version failed"

  profile="$(ensure_path "$dir")"
  report_other_installs "$launcher" "$remove_other_installs" "$work"
  write_receipt "$channel" "$version" "$asset" "$launcher" "$profile"
  say ""
  say "omo ${version} is installed at ${launcher}."
  if [ -n "$profile" ]; then
    say "${profile} puts ${dir} on PATH; open a new shell (or run: export PATH=\"${dir}:\$PATH\") and run: omo"
  else
    say "Run: omo"
  fi
  say ""
  say "OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product."
  say "The data goes to PostHog in the United States."
  say "Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1)."
  say "Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
OMO_INSTALL_BASH
if [ -n "$omo_sourced" ]; then
  # Sourced by Bash (the installer tests): define the installer functions here without running main.
  trap - EXIT HUP INT TERM
  # shellcheck source=/dev/null
  . "$omo_bash_script"
  rm -f "$omo_bash_script"
  return 0
fi
"$omo_bash" "$omo_bash_script" "$@"
omo_bash_status=$?
rm -f "$omo_bash_script"
trap - EXIT HUP INT TERM
exit "$omo_bash_status"
