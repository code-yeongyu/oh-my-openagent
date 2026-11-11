#!/bin/sh
# SP-R pair helper. probe-sp-r.ts pipes this script over stdin to one host of a same-network pair and runs it there:
#   sh -s -- state                  read-only: the host's load and cores, the device service version, and whether the
#                                   device service listens on anything but loopback (a same-network direct path would)
#   sh -s -- silent <socket url>    opens ONE unauthenticated socket to a relay, sends nothing, and reports when and how
#                                   the relay closes it (no account, no token, no frame sent)
# It leaves nothing behind: its only file is a temp script, removed on every exit path, and the socket closes itself.
# It refuses to run when the host's 1-minute load is at or above its core count.
set -u
mode="${1:-}"
cores=$(sysctl -n hw.ncpu 2>/dev/null || nproc)
load=$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')
[ -n "$load" ] || load=$(cut -d' ' -f1 /proc/loadavg)
if awk -v l="$load" -v c="$cores" 'BEGIN{exit !(l >= c)}'; then
  echo "busy load=$load cores=$cores"
  exit 75
fi
echo "load=$load cores=$cores"
case "$mode" in
  state)
    svc=$(ps -axo pid=,command= | awk '/[o]mo-device-service run/{print $1; exit}')
    if [ -z "$svc" ]; then
      echo "device_service=absent"
      exit 0
    fi
    ver=$(ps -o command= -p "$svc" | sed -n 's#.*/bin/\([^/]*\)/omo-device-service.*#\1#p')
    echo "device_service=running version=$ver"
    # Every listening socket the device service and its children hold; a direct path would listen off loopback.
    kids=$(pgrep -P "$svc" | tr '\n' ',')
    lsof -nP -a -iTCP -sTCP:LISTEN -p "${kids}${svc}" 2>/dev/null | awk 'NR>1{print $9}' | sort -u > /tmp/sp-r-listen.$$
    echo "listeners_total=$(wc -l < /tmp/sp-r-listen.$$ | tr -d ' ')"
    echo "listeners_off_loopback=$(grep -v -c -E '^(127\.0\.0\.1|\[::1\]|localhost):' /tmp/sp-r-listen.$$)"
    rm -f /tmp/sp-r-listen.$$
    udp=$(lsof -nP -a -iUDP -p "${kids}${svc}" 2>/dev/null | awk 'NR>1' | grep -c -E ':5353|\*:')
    echo "udp_discovery_sockets=$udp"
    ;;
  silent)
    url="${2:?socket url}"
    bun=$(command -v bun || ls "$HOME/.bun/bin/bun" 2> /dev/null)
    [ -n "$bun" ] || { echo "precondition missing: bun"; exit 2; }
    tmp=$(mktemp -t sp-r-silent.XXXXXX)
    trap 'rm -f "$tmp"' EXIT INT TERM HUP
    cat > "$tmp" << 'EOF'
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
    "$bun" "$tmp" "$url"
    ;;
  *)
    echo "usage: sh -s -- state | silent <socket url>"
    exit 2
    ;;
esac
