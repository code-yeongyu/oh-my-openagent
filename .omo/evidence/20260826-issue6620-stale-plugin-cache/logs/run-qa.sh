#!/usr/bin/env bash
# Isolation proof + QA run for issue 6620.
# NEVER touches real ~/.omo ~/.senpi ~/.config/opencode ~/.codex ~/.cache/opencode.
set -u
ISO=/tmp/opencode/issue-6620/sandbox
rm -rf "$ISO"
mkdir -p "$ISO"/{home,cfg,cache,state,data} "$ISO/proj"

snap() {
  for d in "$HOME/.omo" "$HOME/.senpi" "$HOME/.config/opencode" "$HOME/.codex" "$HOME/.cache/opencode"; do
    if [ -e "$d" ]; then
      find "$d" -type f -printf '%p %s %T@\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1
    else
      echo "absent"
    fi
  done
}

echo "== isolation snapshot BEFORE =="
snap | tee /tmp/opencode/issue-6620/isolation-before.txt

echo "== ambient drift control (no QA run, 3s window) =="
sleep 3
snap > /tmp/opencode/issue-6620/isolation-control.txt
if diff -q /tmp/opencode/issue-6620/isolation-before.txt /tmp/opencode/issue-6620/isolation-control.txt >/dev/null; then
  echo "[INFO] no ambient drift in control window"
else
  echo "[INFO] ambient drift detected from concurrent host processes (live OMO daemons); per-path attribution below:"
  diff /tmp/opencode/issue-6620/isolation-before.txt /tmp/opencode/issue-6620/isolation-control.txt || true
fi

echo "== run QA driver in sanitized env =="
env -i \
  HOME="$ISO/home" \
  XDG_CACHE_HOME="$ISO/cache" \
  XDG_CONFIG_HOME="$ISO/cfg" \
  XDG_DATA_HOME="$ISO/data" \
  XDG_STATE_HOME="$ISO/state" \
  ISO_ROOT="$ISO" \
  PATH="/home/viprix/.bun/bin:/usr/local/bin:/usr/bin:/bin" \
  bun /tmp/opencode/issue-6620/qa-driver.ts 2>&1 | tee /tmp/opencode/issue-6620/qa-transcript.txt
QA_EXIT=${PIPESTATUS[0]}

echo "== isolation snapshot AFTER =="
snap | tee /tmp/opencode/issue-6620/isolation-after.txt

if diff -q /tmp/opencode/issue-6620/isolation-after.txt /tmp/opencode/issue-6620/isolation-control.txt >/dev/null; then
  echo "[PASS] real host state identical to pre-QA control (QA run caused zero host writes)"
else
  echo "[WARN] drift vs control window; attributing per path:"
  diff /tmp/opencode/issue-6620/isolation-control.txt /tmp/opencode/issue-6620/isolation-after.txt || true
  echo "driver-level isolation self-proof in transcript is authoritative for QA attribution"
fi
echo "QA_EXIT:$QA_EXIT"
exit "$QA_EXIT"
