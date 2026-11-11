#!/bin/bash
# SP-T helper: the run-local T3 signing identity (macOS only).
#
#   sp-t-identity.sh create   self-signed code-signing certificate in a dedicated keychain FILE under
#                             $CU_RUN/t3-signing/ (never the login keychain, never added to the search list,
#                             no trust setting, so no dialog); writes its name to $CU_RUN/t3-signing/IDENTITY
#   sp-t-identity.sh show     prints the identity name, its SHA-1 and what `security` sees in the keychain file
#   sp-t-identity.sh delete   final teardown only: deletes the keychain file and the directory
#
# The keychain password is a random throwaway kept 0600 beside the keychain; it unlocks nothing else.
set -euo pipefail

die() { echo "sp-t-identity: $*" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || die "missing precondition: a macOS host (uname -s is $(uname -s))"
: "${CU_RUN:?missing precondition: CU_RUN is not set}"
dir="$CU_RUN/t3-signing"
keychain="$dir/t3.keychain-db"

case "${1:-}" in
create)
	[ ! -e "$dir/IDENTITY" ] || die "identity already exists: $(cat "$dir/IDENTITY") (delete it first to replace it)"
	umask 077
	mkdir -p "$dir"
	tmp=$(mktemp -d "$dir/.create.XXXXXX")
	trap 'rm -rf "$tmp"' EXIT
	name="OmO CU v3 T3 test signing $(date -u +%Y%m%dT%H%M%SZ)"
	openssl rand -hex 24 >"$dir/keychain-password"
	p12pass=$(openssl rand -hex 24)
	cat >"$tmp/req.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF
	openssl req -x509 -newkey rsa:2048 -nodes -days 30 -config "$tmp/req.cnf" \
		-keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
	legacy=()
	if openssl version | grep -q '^OpenSSL 3'; then legacy=(-legacy); fi
	openssl pkcs12 -export ${legacy[@]+"${legacy[@]}"} -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -name "$name" \
		-out "$tmp/id.p12" -passout "pass:$p12pass"
	security create-keychain -p "$(cat "$dir/keychain-password")" "$keychain"
	security set-keychain-settings "$keychain" # no auto-lock timeout, no lock on sleep
	security unlock-keychain -p "$(cat "$dir/keychain-password")" "$keychain"
	security import "$tmp/id.p12" -k "$keychain" -f pkcs12 -P "$p12pass" -T /usr/bin/codesign >/dev/null
	security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$(cat "$dir/keychain-password")" "$keychain" >/dev/null
	openssl x509 -in "$tmp/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g' >"$dir/IDENTITY.sha1"
	cp "$tmp/cert.pem" "$dir/cert.pem"
	echo "$name" >"$dir/IDENTITY"
	echo "identity=$name"
	echo "sha1=$(cat "$dir/IDENTITY.sha1")"
	echo "keychain=$keychain"
	;;
show)
	[ -s "$dir/IDENTITY" ] || die "missing precondition: no T3 identity under $dir"
	echo "identity=$(cat "$dir/IDENTITY")"
	echo "sha1=$(cat "$dir/IDENTITY.sha1")"
	security find-identity -p codesigning "$keychain" | sed 's/^/find-identity: /'
	;;
delete)
	[ -e "$keychain" ] && security delete-keychain "$keychain"
	rm -rf "$dir"
	[ ! -e "$dir" ] && echo "dir REMOVED $dir"
	;;
*)
	die "usage: sp-t-identity.sh create | show | delete"
	;;
esac
