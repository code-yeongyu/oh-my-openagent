#!/bin/sh
# Class checks for probe-sp-r-pair.sh, run by `probe-sp-r.ts --self-test` (Linux or macOS, needs bun and lsof).
#   sh probe-sp-r-pair-selftest.sh <path to probe-sp-r-pair.sh>
# A same-network "zero listeners" reading is trusted only when lsof demonstrably works: every way lsof can fail
# (missing, silent, erroring, blind to the target) must end in exit 2, never in a zero. Each case runs the helper
# against a fake device service this script starts and stops itself; nothing it starts outlives it.
set -u
helper="${1:?usage: probe-sp-r-pair-selftest.sh <probe-sp-r-pair.sh>}"
bun=$(command -v bun || ls "$HOME/.bun/bin/bun" 2> /dev/null)
reallsof=$(command -v lsof)
[ -n "$bun" ] && [ -n "$reallsof" ] || {
  echo "FAIL helper self-test preconditions: needs bun and lsof"
  exit 1
}
work=$(mktemp -d "${TMPDIR:-/tmp}/sp-r-pairtest.XXXXXX") || exit 1
svc=""
stop_svc() {
  [ -n "$svc" ] && kill "$svc" 2> /dev/null && wait "$svc" 2> /dev/null
  svc=""
}
cleanup() {
  stop_svc
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
fails=0
check() { # name, condition result (0 = pass), detail
  if [ "$2" -eq 0 ]; then echo "PASS helper: $1"; else
    echo "FAIL helper: $1 -- $3"
    fails=$((fails + 1))
  fi
}
# A fake device service: a process whose command line holds "omo-device-service run", listening as asked.
mkdir -p "$work/svc/bin/9.9.9"
# The helper must read this fake, not a real device service that may run on the test host.
export SP_R_PAIR_SERVICE_MATCH="$work/svc/bin/9.9.9/omo-device-service run"
cat > "$work/svc/bin/9.9.9/omo-device-service" << 'EOF'
const mode = process.argv[3] ?? "none"
const s = { data() {} }
if (mode === "any") Bun.listen({ hostname: "0.0.0.0", port: 0, socket: s })
if (mode === "lo") Bun.listen({ hostname: "127.0.0.1", port: 0, socket: s })
setInterval(() => {}, 1_000)
EOF
start_svc() { # mode
  stop_svc
  "$bun" "$work/svc/bin/9.9.9/omo-device-service" run "$1" > /dev/null 2>&1 &
  svc=$!
  sleep 1
}
run_helper() { # extra PATH dir (or ""), then helper args; output in $work/out, exit in $rc
  if [ -n "$1" ]; then p="$1:$PATH"; else p="$PATH"; fi
  shift
  SP_R_PAIR_MAX_LOAD=100000 PATH="$p" sh "$helper" "$@" > "$work/out" 2>&1
  rc=$?
}
# The helper gets a private TMPDIR, so its temp dirs and its bun control (whose script lives there) are attributable
# to this run even when another run is going; nc control listeners carry no path, so they are counted against a
# baseline taken before the first case.
export TMPDIR="$work/tmp"
mkdir -p "$TMPDIR"
nc_count() { ps -axo command= | grep -c -E '^nc -l (127\.0\.0\.1 )?[0-9]+$'; }
nc_base=$(nc_count)
leftovers() { # processes or temp files the helper left behind
  n=$(ps -axo command= | grep -F "$TMPDIR/" | grep -c -v -F 'grep')
  f=$(ls -d "$TMPDIR"/sp-r-state.* 2> /dev/null | wc -l | tr -d ' ')
  d=$(($(nc_count) - nc_base))
  [ $d -lt 0 ] && d=0
  echo $((n + f + d))
}
field() { tr ' ' '\n' < "$work/out" | sed -n "s/^$1=//p" | head -1; }

# 1. lsof missing: a PATH that has every tool the helper uses except lsof.
mkdir -p "$work/nolsof"
for t in sh awk ps sort grep wc tr sed sysctl nproc pgrep mktemp cat rm kill sleep head base64 id ls cut mv; do
  w=$(command -v "$t") && ln -s "$w" "$work/nolsof/$t"
done
ln -s "$bun" "$work/nolsof/bun"
start_svc any
SP_R_PAIR_MAX_LOAD=100000 PATH="$work/nolsof" sh "$helper" state > "$work/out" 2>&1
rc=$?
check "lsof missing -> exit 2 naming lsof" "$([ $rc -eq 2 ] && grep -q lsof "$work/out" && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"

# 2-3. lsof that prints nothing (silent zero) or only an error: the positive control must fail.
mkdir -p "$work/silent" "$work/erroring" "$work/blind"
printf '#!/bin/sh\nexit 1\n' > "$work/silent/lsof"
printf '#!/bin/sh\necho "lsof: WARNING: permission denied" >&2\nexit 1\n' > "$work/erroring/lsof"
# 4. lsof that sees everything except the device service (another user's or a root daemon on macOS).
printf '#!/bin/sh\ncase " $* " in *"%s"*) exit 1 ;; esac\nexec %s "$@"\n' "TARGETPID" "$reallsof" > "$work/blind/lsof.in"
chmod +x "$work/silent/lsof" "$work/erroring/lsof"
for kind in silent erroring; do
  run_helper "$work/$kind" state
  check "lsof $kind -> exit 2, no zero reported" "$([ $rc -eq 2 ] && ! grep -q 'listeners_total=' "$work/out" && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"
done
sed "s/TARGETPID/-p $svc/" "$work/blind/lsof.in" > "$work/blind/lsof" && chmod +x "$work/blind/lsof"
run_helper "$work/blind" state
check "lsof blind to the device service -> exit 2" "$([ $rc -eq 2 ] && ! grep -q 'listeners_total=' "$work/out" && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"

# 4b. lsof that answers for the device service only with rows that carry no numeric FD (round 2): what Linux lsof
# prints for another user's process ("Permission denied" cwd/rtd/txt rows, a NOFD row). That is not visibility: exit 2.
# The control variant adds one numeric-FD row and must pass the visibility check.
mkdir -p "$work/denied"
cat > "$work/denied/rows.denied" << 'EOF'
COMMAND     PID USER   FD      TYPE DEVICE SIZE/OFF NODE NAME
omo-devic SVCPID root  cwd   unknown                      /proc/SVCPID/cwd (readlink: Permission denied)
omo-devic SVCPID root  rtd   unknown                      /proc/SVCPID/root (readlink: Permission denied)
omo-devic SVCPID root  txt   unknown                      /proc/SVCPID/exe (readlink: Permission denied)
omo-devic SVCPID root NOFD                                /proc/SVCPID/fd (opendir: Permission denied)
EOF
printf '%s\n' 'COMMAND     PID USER   FD      TYPE DEVICE SIZE/OFF NODE NAME' 'omo-devic SVCPID root NOFD                                /proc/SVCPID/fd (opendir: Permission denied)' > "$work/denied/rows.nofd"
{ cat "$work/denied/rows.denied"; echo 'omo-devic SVCPID me      3u  IPv4  12345      0t0  TCP 127.0.0.1:5000 (LISTEN)'; } > "$work/denied/rows.numeric"
for variant in denied nofd numeric; do
  start_svc any
  sed "s/SVCPID/$svc/g" "$work/denied/rows.$variant" > "$work/denied/rows"
  # Only the visibility call (-p <service> with no -i/-U) is faked; every other lsof call is the real one.
  printf '#!/bin/sh\ncase " $* " in *" -i"*|*" -U"*) exec %s "$@" ;; esac\ncase " $* " in *"-p %s "*) cat %s; exit 0 ;; esac\nexec %s "$@"\n' "$reallsof" "$svc" "$work/denied/rows" "$reallsof" > "$work/denied/lsof"
  chmod +x "$work/denied/lsof"
  run_helper "$work/denied" state
  if [ "$variant" = numeric ]; then
    check "lsof rows with one numeric FD -> target visible" "$([ $rc -eq 0 ] && [ "$(field target_visible)" = yes ] && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"
  else
    check "lsof rows only $variant (no numeric FD) -> exit 2, no zero reported" "$([ $rc -eq 2 ] && ! grep -q 'listeners_total=' "$work/out" && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"
  fi
done

# 5-7. real lsof: the control comes first and passes, then the reading is trusted.
tools="bun"
nc -h 2>&1 | grep -q -i -E 'openbsd|apple|usage: nc' && tools="bun nc"
for tool in $tools; do
for mode in any lo none; do
  start_svc "$mode"
  SP_R_PAIR_CONTROL=$tool run_helper "" state
  case $mode in any) want_t=1 want_o=1 ;; lo) want_t=1 want_o=0 ;; none) want_t=0 want_o=0 ;; esac
  ok=1
  [ $rc -eq 0 ] && [ "$(field control)" = ok ] && [ "$(field target_visible)" = yes ] &&
    [ "$(field listeners_total)" = "$want_t" ] && [ "$(field listeners_off_loopback)" = "$want_o" ] && ok=0
  check "real lsof, $tool control, service listening $mode -> control ok, listeners $want_t, off loopback $want_o" "$ok" "exit $rc: $(cat "$work/out")"
  cl=$(grep -n 'control=ok' "$work/out" | head -1 | cut -d: -f1)
  rl=$(grep -n 'listeners_total=' "$work/out" | head -1 | cut -d: -f1)
  check "control shown before the reading ($mode, $tool control)" "$([ -n "$cl" ] && [ -n "$rl" ] && [ "$cl" -lt "$rl" ] && echo 0 || echo 1)" "$(cat "$work/out")"
  check "nothing left behind ($mode, $tool control)" "$([ "$(leftovers)" = 0 ] && echo 0 || echo 1)" "$(leftovers) leftovers"
done
done

# 8. no device service: reported as absent (the probe makes that UNMEASURED), control still first.
stop_svc
run_helper "" state
check "no device service -> device_service=absent" "$([ $rc -eq 0 ] && [ "$(field device_service)" = absent ] && echo 0 || echo 1)" "exit $rc: $(cat "$work/out")"

# 9. an interrupt mid-run leaves nothing behind (control listener and temp dir go with the trap).
start_svc any
mkdir -p "$work/slow"
printf '#!/bin/sh\nsleep 30\n' > "$work/slow/lsof" && chmod +x "$work/slow/lsof"
# Ctrl-C reaches the whole process group, so the helper runs as its own job and the group gets the signal.
set -m
SP_R_PAIR_MAX_LOAD=100000 PATH="$work/slow:$PATH" sh "$helper" state > "$work/out" 2>&1 &
hp=$!
set +m
sleep 2
kill -INT -- "-$hp" 2> /dev/null
wait "$hp" 2> /dev/null
sleep 1
check "interrupt mid-run -> nothing left behind" "$([ "$(leftovers)" = 0 ] && echo 0 || echo 1)" "$(leftovers) leftovers"

# 10. the helper never writes a fixed temp name.
check "no fixed temp path in the helper" "$(grep -q -E '/tmp/sp-r-[a-z]+\.\$\$' "$helper" && echo 1 || echo 0)" "fixed path found"

# 11. the load gate still refuses (default: the host's own core count).
start_svc any
PATH="$PATH" SP_R_PAIR_MAX_LOAD=0 sh "$helper" state > "$work/out" 2>&1
rc=$?
check "load at or above the gate -> exit 75" "$([ $rc -eq 75 ] && echo 0 || echo 1)" "exit $rc"

[ "$fails" -eq 0 ] && echo "helper self-test: all checks passed" || echo "helper self-test: $fails check(s) failed"
[ "$fails" -eq 0 ]
