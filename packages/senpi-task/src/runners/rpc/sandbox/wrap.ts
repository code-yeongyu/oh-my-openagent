import { existsSync } from "node:fs"

import type { DenyLivePlan } from "./plan"

// fd the seccomp program is handed on; the spawner opens `seccompFile` there.
export const SECCOMP_FD = 3

export type WrappedCommand = {
  readonly command: string
  readonly args: readonly string[]
  readonly seccompFile?: string
}

export function wrapDenyLive(
  plan: DenyLivePlan,
  command: string,
  args: readonly string[],
  seccompFile?: string,
): WrappedCommand {
  if (plan.platform === "darwin") {
    return { command: plan.backend, args: ["-p", seatbeltProfile(plan), "--", command, ...args] }
  }
  if (seccompFile === undefined) throw new Error("the Linux deny-live wrapper needs its seccomp program")
  return {
    command: plan.backend,
    args: [...bwrapArgs(plan), "--seccomp", String(SECCOMP_FD), "--", command, ...args],
    seccompFile,
  }
}

/**
 * Mount order is rule order (the later mount wins): everything read-only, private /tmp and
 * /run/user/<uid>, the live roots re-exposed read-only over those, the cwd writable, its control entries
 * read-only again, then the report dir and the child's state dir writable.
 */
export function bwrapArgs(plan: DenyLivePlan): readonly string[] {
  const roBind = (path: string) => ["--ro-bind", path, path]
  const bind = (path: string) => ["--bind", path, path]
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--unshare-pid",
    "--unshare-ipc",
    "--die-with-parent",
    ...plan.privateDirs.flatMap((dir) => ["--tmpfs", dir]),
    ...[plan.home, plan.liveRoot, plan.agentDir, ...plan.codeRoots].filter(existsSync).flatMap(roBind),
    ...bind(plan.cwd),
    ...plan.projectControl.filter(existsSync).flatMap(roBind),
    ...bind(plan.artifactDir),
    ...bind(plan.stateDir),
    "--chdir",
    plan.cwd,
  ]
}

export function seatbeltProfile(plan: DenyLivePlan): string {
  const subpath = (path: string) => `(subpath ${quote(path)})`
  const literal = (path: string) => `(literal ${quote(path)})`
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${subpath(plan.cwd)} ${literal("/dev/null")} ${literal("/dev/tty")} ${literal("/dev/dtracehelper")} ${literal("/dev/ptmx")} (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))`,
    `(deny file-write* ${plan.projectControl.map((path) => `${literal(path)} ${subpath(path)}`).join(" ")})`,
    `(allow file-write* ${subpath(plan.artifactDir)} ${subpath(plan.stateDir)})`,
    "(deny network-outbound (remote unix-socket))",
    `(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))`,
    "(deny appleevent-send)",
    "(deny mach-priv-task-port)",
    `(deny process-exec ${literal("/bin/launchctl")} ${literal("/usr/bin/osascript")})`,
  ].join("\n")
}

function quote(path: string): string {
  return JSON.stringify(path)
}
