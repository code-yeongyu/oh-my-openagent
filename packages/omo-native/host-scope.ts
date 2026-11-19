// omo#14341: on Linux a host supervisor, and the host and tool children it spawns, stay in the systemd cgroup of
// whatever started them (an ensure loop service, the oneshot session host unit, a terminal holder, an ssh scope). That
// unit's OOMPolicy then decides the host's fate: one OOM-killed tool child stops the unit and SIGTERMs every session.
// A compiled supervisor therefore re-execs itself in place inside its own transient user scope. `systemd-run --scope`
// execs the command itself, so the pid, argv, environment, cwd, stdio and the engine's coordinated descriptor table
// (the owner fd, the private fds and the startup pipe, 3..STARTUP_EVENT_FD) are the ones the engine spawned. Without a
// user manager, a coordinated launch or libc it keeps the direct launch.

import { dlopen, FFIType, ptr } from "bun:ffi"
import { spawnSync } from "node:child_process"
import { accessSync, constants, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { HOST_STARTUP_EVENTS_ENV } from "../../node_modules/@code-yeongyu/senpi/dist/modes/rpc/host-identity-env.js"
import { STARTUP_EVENT_FD } from "../../node_modules/@code-yeongyu/senpi/dist/modes/rpc/host-startup-wire.js"
import { isInternalSupervisorLaunch } from "./supervisor-fast-path"

const UNIT_PREFIX = "omo-host-"
const IN_HOST_SCOPE = /\/omo-host-[^/\s]*\.scope$/m
/** Scope units accept OOMPolicy= from systemd 253; an older manager refuses the whole scope. */
const SCOPE_OOM_POLICY_SINCE = 253
const MANAGER_PROBE_TIMEOUT_MS = 2_000
const F_SETFD = 2
const FD_CLOEXEC = 1

export interface HostScopeContext {
  readonly platform: NodeJS.Platform
  readonly systemdRun: string | undefined
  readonly managerVersion: number | undefined
  readonly cgroup: string
  readonly unit: string
  /** The engine's startup hand-off is present, so its descriptor table fills 3..STARTUP_EVENT_FD. */
  readonly coordinated: boolean
}

/** The argv that launches `argv` in its own transient user scope, or `argv` itself when that is not available. */
export function hostScopeArgv(argv: readonly string[], context: HostScopeContext): readonly string[] {
  if (context.platform !== "linux" || context.systemdRun === undefined || !context.coordinated) return argv
  if (context.managerVersion === undefined || context.managerVersion < SCOPE_OOM_POLICY_SINCE) return argv
  if (IN_HOST_SCOPE.test(context.cgroup)) return argv
  return [
    context.systemdRun,
    "--user",
    "--scope",
    "--collect",
    "--quiet",
    `--unit=${context.unit}`,
    "-p",
    "OOMPolicy=continue",
    "-p",
    "MemoryMax=90%",
    "--",
    ...argv,
  ]
}

export function hostScopeUnitName(pid: number, nonce: string): string {
  return `${UNIT_PREFIX}${pid}-${nonce.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`
}

export function parseSystemdVersion(text: string): number | undefined {
  const major = /^(\d+)/.exec(text.trim())?.[1]
  return major === undefined ? undefined : Number(major)
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return undefined
}

/** A user manager this user owns answers on `$XDG_RUNTIME_DIR/systemd/private`; containers and sudo shells have none. */
function ownUserManagerSocket(env: NodeJS.ProcessEnv): boolean {
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (runtimeDir === undefined || runtimeDir === "") return false
  try {
    const socket = statSync(join(runtimeDir, "systemd", "private"))
    return socket.isSocket() && socket.uid === process.getuid?.()
  } catch {
    return false
  }
}

function managerVersion(env: NodeJS.ProcessEnv): number | undefined {
  if (!ownUserManagerSocket(env)) return undefined
  const systemctl = onPath("systemctl", env)
  if (systemctl === undefined) return undefined
  const answer = spawnSync(systemctl, ["--user", "show", "-p", "Version", "--value"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: MANAGER_PROBE_TIMEOUT_MS,
  })
  return answer.status === 0 ? parseSystemdVersion(answer.stdout) : undefined
}

function readCgroup(): string {
  try {
    return readFileSync("/proc/self/cgroup", "utf8")
  } catch {
    return ""
  }
}

function probeHostScopeContext(env: NodeJS.ProcessEnv): HostScopeContext {
  const systemdRun = onPath("systemd-run", env)
  return {
    platform: process.platform,
    systemdRun,
    managerVersion: systemdRun === undefined ? undefined : managerVersion(env),
    cgroup: readCgroup(),
    unit: hostScopeUnitName(process.pid, randomUUID()),
    coordinated: env[HOST_STARTUP_EVENTS_ENV] !== undefined,
  }
}

function libcName(): string {
  if (process.versions.musl === undefined) return "libc.so.6"
  return `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`
}

function cString(value: string): Buffer {
  return Buffer.from(`${value}\0`)
}

/**
 * Execs `argv` through libc with this process's own environment. Bun's `process.execve` closes every descriptor above
 * stdio, so the engine's table is handed on only by libc `execv` after close-on-exec is cleared on it. Returns only when
 * the exec failed, with close-on-exec restored on what it cleared.
 */
function openLibc() {
  try {
    return dlopen(libcName(), {
      fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
      execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    })
  } catch {
    return undefined
  }
}

function execKeepingDescriptors(argv: readonly string[]): void {
  const libc = openLibc()
  if (libc === undefined) return
  const cleared: number[] = []
  for (let fd = 3; fd <= STARTUP_EVENT_FD; fd += 1) {
    if (libc.symbols.fcntl(fd, F_SETFD, 0) === 0) cleared.push(fd)
  }
  const strings = argv.map(cString)
  const table = new BigUint64Array(strings.length + 1)
  strings.forEach((value, index) => {
    table[index] = BigInt(ptr(value))
  })
  const file = cString(argv[0] ?? "")
  libc.symbols.execv(ptr(file), ptr(table))
  for (const fd of cleared) libc.symbols.fcntl(fd, F_SETFD, FD_CLOEXEC)
  libc.close()
}

/**
 * Called first thing by the compiled entry with its raw argv: a Linux host supervisor that is not yet in its own scope
 * replaces itself with the scoped launch and never returns. Every other launch returns and continues unchanged.
 */
export function enterOwnHostScope(args: readonly string[]): void {
  if (process.platform !== "linux" || !isInternalSupervisorLaunch(args)) return
  const argv = [process.execPath, ...args]
  const scoped = hostScopeArgv(argv, probeHostScopeContext(process.env))
  if (scoped !== argv) execKeepingDescriptors(scoped)
}
