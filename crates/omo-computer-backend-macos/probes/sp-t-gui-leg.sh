#!/bin/bash
# SP-T helper: run one probe leg inside the QA account's graphical session (macOS only).
#
#   sp-t-gui-leg.sh <label> <timeout-seconds> <done-file> <log-file> -- <program> [args...]
#
# Writes a one-shot LaunchAgent (RunAtLoad, no KeepAlive, LimitLoadToSessionType=Aqua) whose ProgramArguments
# are the given command, bootstraps it into gui/<uid>, waits up to <timeout-seconds> for <done-file>, then boots it
# out and removes the plist. The job is its own responsible process, which is the shape of a hand tool host
# installed as a LaunchAgent in the user's session.
#
# SPT_QA_USER   the account whose session is used (default: the current user)
# SPT_GUI_ROUTE self  -> `launchctl bootstrap gui/<uid>` as that user (the process must already be that user)
#               sudo  -> `sudo -n launchctl bootstrap gui/<uid>` (a root sudo ticket, from another account)
set -euo pipefail

die() { echo "sp-t-gui-leg: $*" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || die "missing precondition: a macOS host (uname -s is $(uname -s))"
[ $# -ge 6 ] && [ "$5" = "--" ] || die "usage: sp-t-gui-leg.sh <label> <timeout> <done-file> <log-file> -- <program> [args...]"
label=$1 timeout=$2 done_file=$3 log_file=$4
shift 5

user=${SPT_QA_USER:-$(id -un)}
# the account and the label are used as plain words (dscl record, plist file name): refuse anything else
case "$user" in '' | *[!A-Za-z0-9._-]*) die "SPT_QA_USER must be a plain account name (got '$user')" ;; esac
case "$label" in '' | *[!A-Za-z0-9._-]*) die "the label must be a plain reverse-DNS word (got '$label')" ;; esac
uid=$(id -u "$user")
# home directory from the directory service, never through eval/tilde expansion of the account name
home=$(dscl . -read "/Users/$user" NFSHomeDirectory | sed -n 's/^NFSHomeDirectory: //p')
case "$home" in /*) ;; *) die "no home directory for $user in the directory service" ;; esac
route=${SPT_GUI_ROUTE:-self}
case "$route" in
self)
	[ "$(id -u)" = "$uid" ] || die "missing precondition: SPT_GUI_ROUTE=self needs the process to run as $user"
	as=()
	;;
sudo)
	sudo -n true 2>/dev/null || die "missing precondition: SPT_GUI_ROUTE=sudo needs a root sudo ticket"
	as=(sudo -n)
	;;
*) die "SPT_GUI_ROUTE must be self or sudo (got $route)" ;;
esac

plist_dir=$(mktemp -d "${TMPDIR:-/tmp}/sp-t-leg.XXXXXX")
chmod 755 "$plist_dir"
plist="$plist_dir/$label.plist"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
{
	echo '<?xml version="1.0" encoding="UTF-8"?>'
	echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
	echo '<plist version="1.0"><dict>'
	echo "<key>Label</key><string>$(printf '%s' "$label" | xml_escape)</string>"
	echo '<key>ProgramArguments</key><array>'
	for arg in "$@"; do echo "<string>$(printf '%s' "$arg" | xml_escape)</string>"; done
	echo '</array>'
	echo '<key>RunAtLoad</key><true/>'
	echo '<key>LimitLoadToSessionType</key><string>Aqua</string>'
	echo '<key>EnvironmentVariables</key><dict>'
	echo "<key>HOME</key><string>$(printf '%s' "$home" | xml_escape)</string>"
	echo "<key>PATH</key><string>$(printf '%s' "$(dirname "$1"):/usr/bin:/bin:/usr/sbin:/sbin" | xml_escape)</string>"
	for name in CU_RUN EV SPT_COMMIT SPT_QA_USER; do
		if [ -n "${!name:-}" ]; then echo "<key>$name</key><string>$(printf '%s' "${!name}" | xml_escape)</string>"; fi
	done
	echo '</dict>'
	echo "<key>StandardOutPath</key><string>$(printf '%s' "$log_file" | xml_escape)</string>"
	echo "<key>StandardErrorPath</key><string>$(printf '%s' "$log_file" | xml_escape)</string>"
	echo '</dict></plist>'
} >"$plist"
chmod 644 "$plist"

cleanup() {
	bootout_rc=0
	${as[@]+"${as[@]}"} launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || bootout_rc=$?
	echo "bootout_rc=$bootout_rc"
	rm -rf "$plist_dir"
}
trap cleanup EXIT

echo "route=$route uid=$uid label=$label"
bootstrap_rc=0
${as[@]+"${as[@]}"} launchctl bootstrap "gui/$uid" "$plist" 2>&1 || bootstrap_rc=$?
echo "bootstrap_rc=$bootstrap_rc"
[ "$bootstrap_rc" = 0 ] || exit 3

deadline=$((SECONDS + timeout))
# the done file sits in the QA account's 0700 results directory: test it with the same privilege as the bootstrap
done_exists() { ${as[@]+"${as[@]}"} test -e "$done_file"; }
while ! done_exists && [ $SECONDS -lt $deadline ]; do sleep 0.25; done
if done_exists; then echo "leg=done"; else echo "leg=timeout after ${timeout}s"; exit 4; fi
