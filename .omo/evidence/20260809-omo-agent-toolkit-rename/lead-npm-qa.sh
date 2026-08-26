#!/usr/bin/env bash
# ISOLATION CONTRACT: installs only into a disposable --prefix under one mktemp ROOT.
# The caller's real global npm prefix is never a target, and the ROOT is removed at the end.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO" || exit 1

PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

ROOT="$(mktemp -d -t omo-npm-qa)"
NEW_PREFIX="$ROOT/new"; UPG_PREFIX="$ROOT/upgrade"
mkdir -p "$NEW_PREFIX" "$UPG_PREFIX"
echo "== ROOT=$ROOT =="

echo "== packing the working tree =="
TGZ_NAME="$(npm pack --silent --pack-destination "$ROOT" 2>"$ROOT/pack.err" | tail -1)"
TGZ="$ROOT/$TGZ_NAME"
check "npm pack produced a tarball" "[ -f \"$TGZ\" ]"
[ -f "$TGZ" ] || { echo "--- pack.err ---"; tail -20 "$ROOT/pack.err"; rm -rf "$ROOT"; echo "cleanup receipt: rm -rf $ROOT"; exit 1; }

echo "== tarball bin map (source of truth for what npm will link) =="
tar -xzOf "$TGZ" package/package.json > "$ROOT/packed-package.json" 2>/dev/null
echo "packed bin map: $(jq -c '.bin' "$ROOT/packed-package.json")"
PACKED_OMO="$(jq -r '.bin.omo // "absent"' "$ROOT/packed-package.json")"
PACKED_TOOLKIT="$(jq -r '.bin["omo-agent-toolkit"] // "absent"' "$ROOT/packed-package.json")"
check "packed bin map has NO omo entry" "[ '$PACKED_OMO' = 'absent' ]"
check "packed bin map HAS omo-agent-toolkit" "[ '$PACKED_TOOLKIT' != 'absent' ]"
EXPECTED="$(printf '%s\n' lazycodex lazycodex-ai oh-my-openagent oh-my-opencode omo-agent-toolkit | jq -R . | jq -sc .)"
ACTUAL="$(jq -c '.bin | keys' "$ROOT/packed-package.json")"
check "packed bin map is exactly the five surviving names" "[ '$ACTUAL' = '$EXPECTED' ]"
echo "  expected: $EXPECTED"
echo "  actual:   $ACTUAL"

echo "== fresh global install into a disposable prefix =="
npm install -g --prefix "$NEW_PREFIX" "$TGZ" --ignore-scripts >"$ROOT/install-new.log" 2>&1
NEW_RC=$?
echo "install exit=$NEW_RC (see install-new.log)"
if [ -d "$NEW_PREFIX/bin" ]; then
  echo "-- linked bins --"; ls "$NEW_PREFIX/bin" | sort
  check "fresh install links omo-agent-toolkit" "[ -e \"$NEW_PREFIX/bin/omo-agent-toolkit\" ]"
  check "fresh install does NOT link omo" "[ ! -e \"$NEW_PREFIX/bin/omo\" ]"
else
  bad "fresh install produced a bin dir"
fi

echo "== postinstall notice is visible with --foreground-scripts =="
npm install -g --prefix "$ROOT/fg" --foreground-scripts "$TGZ" >"$ROOT/install-fg.log" 2>&1
NOTICE_COUNT="$(grep -c "is now 'omo-agent-toolkit'" "$ROOT/install-fg.log" 2>/dev/null || echo 0)"
echo "notice lines seen: $NOTICE_COUNT"
check "postinstall rename notice appears with --foreground-scripts" "[ \"$NOTICE_COUNT\" -ge 1 ]"

echo "== upgrade-in-place: published old package, then this one over it =="
npm install -g --prefix "$UPG_PREFIX" oh-my-opencode@latest --ignore-scripts >"$ROOT/install-old.log" 2>&1
if [ -e "$UPG_PREFIX/bin/omo" ]; then
  ok "baseline: published package DOES link an omo bin (upgrade is meaningful)"
  npm install -g --prefix "$UPG_PREFIX" "$TGZ" --ignore-scripts >"$ROOT/install-upgrade.log" 2>&1
  echo "-- bins after upgrade --"; ls "$UPG_PREFIX/bin" | sort
  check "upgrade PRUNES the stale omo bin" "[ ! -e \"$UPG_PREFIX/bin/omo\" ]"
  check "upgrade links omo-agent-toolkit" "[ -e \"$UPG_PREFIX/bin/omo-agent-toolkit\" ]"
else
  echo "SKIP: could not install the published package (offline or registry issue); upgrade-prune proof not run"
  tail -5 "$ROOT/install-old.log"
fi

echo
echo "== CLEANUP =="
rm -rf "$ROOT"
if [ -d "$ROOT" ]; then echo "cleanup receipt: FAILED to remove $ROOT"; else echo "cleanup receipt: rm -rf $ROOT (verified absent)"; fi
echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
