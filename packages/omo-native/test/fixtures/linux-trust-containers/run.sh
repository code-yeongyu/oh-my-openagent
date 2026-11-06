#!/bin/sh
# One throwaway distribution container of the Linux trust matrix (omo#10762, design 9.4).
# Usage: run.sh <debian|fedora|alpine|suse> <binary name under /omo>
# /omo holds the compiled engine and the synthetic certificates the test generated; both mounts are
# read-only. Only protocol lines go to stdout (OSID, CONTROL, ENSURE, OPENED, TLS); the rest to stderr.
set -eu
family=$1
engine=/omo/$2
fixture=$(dirname "$0")

case $family in
  debian)
    apt-get update -qq >&2
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ca-certificates strace >&2 ;;
  fedora) dnf install -y -q ca-certificates strace >&2 ;;
  alpine) apk add --no-cache -q ca-certificates strace libstdc++ libgcc >&2 ;;
  suse) zypper -n -q install --no-recommends ca-certificates strace openssl >&2 ;;
  *) echo "unknown family $family" >&2; exit 64 ;;
esac
echo "OSID $(. /etc/os-release && echo "$ID")"

# The throwaway root goes in through the distribution's own tool, exactly as an administrator would.
case $family in
  debian|alpine)
    cp /omo/root.pem /usr/local/share/ca-certificates/omo-trust-matrix-root.crt
    update-ca-certificates >&2 ;;
  fedora)
    cp /omo/root.pem /etc/pki/ca-trust/source/anchors/omo-trust-matrix-root.pem
    update-ca-trust extract >&2 ;;
  suse)
    cp /omo/root.pem /etc/pki/trust/anchors/omo-trust-matrix-root.pem
    update-ca-certificates >&2
    # A second root only in the all-purpose hashed directory, which the importer must never read.
    dir=/var/lib/ca-certificates/openssl
    hashed="$dir/$(openssl x509 -hash -noout -in /omo/dirroot.pem).0"
    test ! -e "$hashed"
    cp /omo/dirroot.pem "$hashed"
    # Control: OpenSSL itself trusts the placement, so a rejection below is the importer's choice.
    if openssl verify -CApath "$dir" /omo/dirleaf.pem >&2; then echo "CONTROL openssl-dir-verifies"; fi ;;
esac

work=$(mktemp -d)
export HOME="$work/home"
mkdir "$HOME"
cd "$work"
strace -f -qq -o "$work/trace" -e trace=open,openat,openat2 "$engine" trust ensure --json > "$work/ensure.json"
echo "ENSURE $(cat "$work/ensure.json")"
# Bundle identity is the path the engine opened, never the certificates the file holds.
for path in /etc/ssl/certs/ca-certificates.crt /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
  /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem /etc/ssl/certs; do
  if grep -q "\"$path\"" "$work/trace"; then echo "OPENED $path"; fi
done
if grep -q '"/var/lib/ca-certificates/openssl' "$work/trace"; then echo "OPENED /var/lib/ca-certificates/openssl"; fi

run_probe() {
  BUN_BE_BUN=1 "$engine" "$fixture/probe.mjs" launch "$work/ensure.json" "$@"
}
run_probe installed /omo/leaf.pem /omo/leaf.key
run_probe closure-only /omo/leaf.pem /omo/leaf.key
if [ "$family" = suse ]; then run_probe openssl-dir-only /omo/dirleaf.pem /omo/dirleaf.key; fi
