#!/bin/sh
# SP-R pair helper. probe-sp-r.ts sends this script to one host of a same-network pair and runs it there:
#   sh -s -- state                  read-only: the host's load and cores, a positive lsof control, then whether the
#                                   device service listens on anything but loopback (a same-network direct path would)
#   sh -s -- silent <socket url>    opens ONE unauthenticated socket to a relay, sends nothing, and reports when and how
#                                   the relay closes it (no account, no token, no frame sent)
# A zero is never reported unless lsof has just shown a listener this script started itself (loopback and all
# interfaces) and can see the device service: lsof missing, silent, erroring or blind ends in exit 2, not in a zero.
# Exit 0 result, 2 precondition missing, 75 host busy. It leaves nothing behind: its temp dir and its control listener
# go with the trap on every exit path. It refuses to run when the host's 1-minute load is at or above its core count
# (SP_R_PAIR_MAX_LOAD overrides that ceiling and SP_R_PAIR_SERVICE_MATCH the device-service match; the helper's own
# self-test uses both).
set -u
mode="${1:-}"
cores=$(sysctl -n hw.ncpu 2> /dev/null || nproc)
load=$(sysctl -n vm.loadavg 2> /dev/null | awk '{print $2}')
[ -n "$load" ] || load=$(cut -d' ' -f1 /proc/loadavg)
ceiling="${SP_R_PAIR_MAX_LOAD:-$cores}"
if awk -v l="$load" -v c="$ceiling" 'BEGIN{exit !(l >= c)}'; then
  echo "busy load=$load cores=$cores"
  exit 75
fi
echo "load=$load cores=$cores"
bun=$(command -v bun || ls "$HOME/.bun/bin/bun" 2> /dev/null)
work=""
ctl=""
cleanup() {
  [ -n "$ctl" ] && kill "$ctl" 2> /dev/null
  [ -n "$work" ] && rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
missing() {
  echo "precondition missing: $1"
  exit 2
}
# Listening TCP endpoints of the given pids (comma list), one per line.
listen_rows() { lsof -nP -a -iTCP -sTCP:LISTEN -p "$1" 2> /dev/null | awk 'NR>1{print $9}' | sort -u; }
off_loopback() { grep -c -v -E '^(127\.[0-9.]+|\[::1\]|localhost):' "$1" || true; }
case "$mode" in
  state)
    command -v lsof > /dev/null 2>&1 || missing "lsof"
    [ -n "$bun" ] || missing "bun (it runs the positive-control listener)"
    work=$(mktemp -d "${TMPDIR:-/tmp}/sp-r-state.XXXXXX") || missing "a temp dir"
    # Positive control: a listener this script owns, on loopback and on all interfaces, must show up in lsof first.
    cat > "$work/control.js" << 'EOF'
const s = { data() {} }
const lo = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: s })
const all = Bun.listen({ hostname: "0.0.0.0", port: 0, socket: s })
require("node:fs").writeFileSync(process.argv[2] + ".tmp", `${lo.port} ${all.port}\n`)
require("node:fs").renameSync(process.argv[2] + ".tmp", process.argv[2])
setTimeout(() => process.exit(0), 60_000)
EOF
    "$bun" "$work/control.js" "$work/ports" sp-r-control > /dev/null 2>&1 &
    ctl=$!
    i=0
    while [ ! -s "$work/ports" ] && [ $i -lt 100 ]; do
      sleep 0.1
      i=$((i + 1))
    done
    [ -s "$work/ports" ] || missing "the positive-control listener did not start"
    read -r lo all < "$work/ports"
    listen_rows "$ctl" > "$work/ctl"
    c_total=$(wc -l < "$work/ctl" | tr -d ' ')
    c_off=$(off_loopback "$work/ctl")
    grep -q -E ":$lo\$" "$work/ctl" && grep -q -E ":$all\$" "$work/ctl" && [ "$c_total" = 2 ] && [ "$c_off" = 1 ] ||
      missing "lsof positive control failed: it saw $c_total of 2 control listeners ($c_off of 1 off loopback)"
    echo "control=ok control_listeners=$c_total control_off_loopback=$c_off"
    kill "$ctl" 2> /dev/null
    ctl=""
    # The device service, matched literally on its command line (SP_R_PAIR_SERVICE_MATCH lets the self-test point
    # at its own fake); ps is read into a file first so the matcher never sees its own command line.
    ps -axo pid=,command= > "$work/ps"
    svc=$(awk -v m="${SP_R_PAIR_SERVICE_MATCH:-omo-device-service run}" 'index($0, m) {print $1; exit}' "$work/ps")
    if [ -z "$svc" ]; then
      echo "device_service=absent"
      exit 0
    fi
    # The target must be visible to lsof (a root daemon or another user's process is not): any open file will do.
    fds=$(lsof -nP -p "$svc" 2> /dev/null | awk 'NR>1' | wc -l | tr -d ' ')
    [ "$fds" -gt 0 ] || missing "lsof cannot see the device service (pid $svc)"
    ver=$(ps -o command= -p "$svc" | sed -n 's#.*/bin/\([^/]*\)/omo-device-service.*#\1#p')
    echo "device_service=running version=$ver target_visible=yes target_fds=$fds"
    pids=$(
      pgrep -P "$svc" | tr '\n' ','
      echo "$svc"
    )
    listen_rows "$pids" > "$work/listen"
    echo "listeners_total=$(wc -l < "$work/listen" | tr -d ' ') listeners_off_loopback=$(off_loopback "$work/listen")"
    unix=$(lsof -nP -a -U -p "$pids" 2> /dev/null | awk 'NR>1' | wc -l | tr -d ' ')
    udp=$(lsof -nP -a -iUDP -p "$pids" 2> /dev/null | awk 'NR>1' | grep -c -E ':5353|\*:' || true)
    echo "unix_sockets=$unix udp_discovery_sockets=$udp"
    ;;
  silent)
    url="${2:?socket url}"
    [ -n "$bun" ] || missing "bun"
    work=$(mktemp -d "${TMPDIR:-/tmp}/sp-r-silent.XXXXXX") || missing "a temp dir"
    cat > "$work/silent.js" << 'EOF'
const url = process.argv[2] ?? "";
const t0 = Date.now();
let opened = -1;
let bytes = 0;
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
ws.onopen = () => { opened = Date.now() - t0; };
ws.onmessage = (e) => { bytes += e.data instanceof ArrayBuffer ? e.data.byteLength : String(e.data).length; };
const done = (code) => {
  console.log(`opened_ms=${opened} closed_after_open_ms=${opened < 0 ? -1 : Date.now() - t0 - opened} code=${code} bytes_in=${bytes}`);
  process.exit(0);
};
ws.onclose = (e) => done(e.code);
setTimeout(() => { ws.close(); done("open_at_90s"); }, 90_000);
EOF
    "$bun" "$work/silent.js" "$url"
    ;;
  *)
    echo "usage: sh -s -- state | silent <socket url>"
    exit 2
    ;;
esac
