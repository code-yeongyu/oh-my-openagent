import { existsSync } from "node:fs"

export type ProbeCheck =
  | { readonly kind: "deny-append"; readonly id: string; readonly target: string }
  | { readonly kind: "deny-hardlink"; readonly id: string; readonly target: string; readonly link: string }
  | { readonly kind: "allow-write"; readonly id: string; readonly target: string }
  | { readonly kind: "deny-unix-socket"; readonly id: string; readonly socketPath: string }
  | { readonly kind: "pid-hidden"; readonly id: string; readonly pid: number }

/** One shell line per check, each printing `<index> pass|fail`; undefined when no socket prober exists. */
export function probeScript(checks: readonly ProbeCheck[]): string | undefined {
  const socketProbe = unixSocketProbe()
  if (socketProbe === undefined && checks.some((check) => check.kind === "deny-unix-socket")) return undefined
  return checks.map((check, index) => `${line(check, socketProbe ?? "false")} && echo "${index} pass" || echo "${index} fail"`).join("\n")
}

function line(check: ProbeCheck, socketProbe: string): string {
  switch (check.kind) {
    case "deny-append": return `! (printf x >> ${q(check.target)}) 2>/dev/null`
    case "deny-hardlink": return `! (ln ${q(check.target)} ${q(check.link)} && printf x >> ${q(check.link)}) 2>/dev/null`
    case "allow-write": return `(printf x > ${q(check.target)}) 2>/dev/null`
    case "deny-unix-socket": return `{ ${socketProbe} ${q(check.socketPath)} 2>/dev/null; test $? -eq 1; }`
    case "pid-hidden": return `! test -e /proc/${check.pid}/root`
  }
}

// Exits with the errno of the first refused step (0 when the connect succeeds). A sandbox refusal is
// EPERM (1) on both platforms: Linux refuses socket(AF_UNIX), macOS refuses the connect. Any other
// errno (a missing socket, a path too long) is not proof of a deny. perl is in every Debian/Ubuntu
// base (perl-base) and in macOS.
function unixSocketProbe(): string | undefined {
  if (existsSync("/usr/bin/perl")) {
    return `/usr/bin/perl -MSocket -e 'socket(my $c, PF_UNIX, SOCK_STREAM, 0) or exit($! + 0); connect($c, pack_sockaddr_un($ARGV[0])) or exit($! + 0); exit 0'`
  }
  if (existsSync("/usr/bin/python3")) {
    return `/usr/bin/python3 -c 'import socket, sys
try: socket.socket(socket.AF_UNIX).connect(sys.argv[1])
except OSError as e: sys.exit(e.errno)'`
  }
  return undefined
}

function q(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
