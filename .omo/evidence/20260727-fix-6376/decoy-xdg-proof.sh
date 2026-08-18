#!/usr/bin/env bash
# Proves the review finding on live-opencode-run.sh: when the caller already has
# XDG_DATA_HOME set, the original driver reads ONE database for its before-count and a
# DIFFERENT one for its after-count, so "count unchanged" says nothing about the database it
# claimed to protect.
#
# Runs the committed (HEAD) driver and the fixed working-copy driver under an identical
# pre-existing XDG_DATA_HOME and prints the two counts each one observed.
#
# usage: decoy-xdg-proof.sh <output-file>
set -uo pipefail

OUT="${1:?usage: decoy-xdg-proof.sh <output-file>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DRIVER_REL=".omo/evidence/20260727-fix-6376/live-opencode-run.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/omo-6376-decoy-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

git -C "$REPO" show "HEAD:$DRIVER_REL" > "$WORK/original.sh"
cp "$REPO/$DRIVER_REL" "$WORK/fixed.sh"

{
  echo "### review finding: restore the original database environment before recounting"
  echo "### both drivers run with the SAME pre-existing XDG_DATA_HOME, as a caller might have"
  echo "### repo: $REPO"
  echo
} > "$OUT"

run_variant() {
  variant_name="$1"
  variant_script="$2"
  decoy="$(mktemp -d "${TMPDIR:-/tmp}/omo-6376-decoyxdg-XXXXXX")"
  result="$WORK/$variant_name.txt"

  # A caller who already exports XDG_DATA_HOME. opencode resolves its database under it.
  XDG_DATA_HOME="$decoy" OMO_REPO_ROOT="$REPO" \
    bash "$variant_script" "$result" >/dev/null 2>&1

  before="$(sed -n 's/.*real sessions before: *//p' "$result" 2>/dev/null | head -1)"
  after="$(sed -n 's/.*real sessions after *: *//p' "$result" 2>/dev/null | head -1)"
  {
    echo "--- $variant_name ---"
    echo "  decoy XDG_DATA_HOME : $decoy"
    echo "  sessions before     : ${before:-<none>}"
    echo "  sessions after      : ${after:-<none>}"
    if [ "${before:-x}" = "${after:-y}" ]; then
      echo "  same database read twice: yes"
    else
      echo "  same database read twice: NO - the two counts came from different databases"
    fi
    echo
  } >> "$OUT"
  rm -rf "$decoy"
}

run_variant "original-committed" "$WORK/original.sh"
run_variant "fixed-working-copy" "$WORK/fixed.sh"

cat "$OUT"
echo "wrote $OUT"
