#!/bin/bash
# SP-T helper: read-only TCC.db read-back for the probe bundle's rows (macOS only).
#
#   sp-t-tccdb.sh <client-substring>
#
# Prints one `#db <scope> <route>` header per database (user, then system), then one tab-separated row per
# access entry whose client contains <client-substring>:
#   service  client  client_type  auth_value  auth_reason  last_modified
# A database the process cannot read prints `#db <scope> UNREADABLE <reason>` and no rows: reading TCC.db needs
# Full Disk Access for the reading process, and the system database also needs root (`sudo -n`). Nothing is
# ever written; the database is opened with mode=ro. Exit 0 only when BOTH databases were read; exit 3 when either is
# unreadable, so a failed read is never taken for "no rows" (the Accessibility rows live in the system database).
set -euo pipefail

die() { echo "sp-t-tccdb: $*" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || die "missing precondition: a macOS host (uname -s is $(uname -s))"
[ $# -eq 1 ] || die "usage: sp-t-tccdb.sh <client-substring>"
case "$1" in *"'"*) die "client substring must not contain a quote" ;; esac

query="select service, client, client_type, auth_value, auth_reason, last_modified from access where client like '%$1%' order by service, client;"

read_db() { # <scope> <path>
	local scope=$1 db=$2 out
	if out=$(sqlite3 -readonly -separator $'\t' "file:$db?mode=ro" "$query" 2>&1); then
		echo "#db $scope direct"
		[ -z "$out" ] || echo "$out"
		return
	fi
	local direct_error=$out
	if sudo -n true 2>/dev/null && out=$(sudo -n sqlite3 -readonly -separator $'\t' "file:$db?mode=ro" "$query" 2>&1); then
		echo "#db $scope sudo"
		[ -z "$out" ] || echo "$out"
		return
	fi
	echo "#db $scope UNREADABLE $(printf '%s' "$direct_error" | head -1)"
	unreadable=$((unreadable + 1))
}

unreadable=0

read_db user "$HOME/Library/Application Support/com.apple.TCC/TCC.db"
read_db system "/Library/Application Support/com.apple.TCC/TCC.db"
[ "$unreadable" = 0 ] || exit 3
