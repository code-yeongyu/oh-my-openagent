// omo#14341: on Linux a host supervisor, and the host and tool children it spawns, stay in the systemd cgroup of
// whatever started them (an ensure loop service, the oneshot session host unit, a terminal holder, an ssh scope). That
// unit's OOMPolicy then decides the host's fate: one OOM-killed tool child stops the unit and SIGTERMs every session.
// A compiled supervisor therefore asks its user manager to move its own pid into a fresh transient scope before it
// spawns its host, so the host and every tool child inherit the scope. The supervisor keeps running in place; any
// failure (no manager, a refused unit, an old systemd, a slow bus) only leaves it where it was.

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { accessSync, constants, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { isInternalSupervisorLaunch } from "./supervisor-fast-path"

/** The supervisor waits at most this long for its scope; the engine's bootstrap phase budget is 30 s. */
const SCOPE_BUDGET_MS = 2_000
const SCOPE_POLL_MS = 10
const MEMORY_MAX_SHARE = 0.9

export interface HostScopeProbes {
  readonly platform: NodeJS.Platform
  readonly args: readonly string[]
  readonly ownsUserManager: () => boolean
  readonly findBusctl: () => string | undefined
  readonly memTotalBytes: () => number | undefined
}

export interface HostScopePlan {
  readonly busctl: string
  readonly argv: readonly string[]
  readonly unit: string
  readonly pid: number
}

export function hostScopeUnitName(pid: number, nonce: string): string {
  return `omo-host-${pid}-${nonce}.scope`
}

export function memoryMaxBytes(meminfo: string): number | undefined {
  const kib = /^MemTotal:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1]
  return kib === undefined ? undefined : Math.floor(Number(kib) * 1024 * MEMORY_MAX_SHARE)
}

/** `systemd-run --user --scope --collect -p OOMPolicy=continue -p MemoryMax=<n>` for an already running pid. */
export function startTransientScopeArgs(unit: string, pid: number, memoryMax: number): readonly string[] {
  return [
    "--user",
    "call",
    "org.freedesktop.systemd1",
    "/org/freedesktop/systemd1",
    "org.freedesktop.systemd1.Manager",
    "StartTransientUnit",
    "ssa(sv)a(sa(sv))",
    unit,
    "fail",
    "4",
    "PIDs",
    "au",
    "1",
    String(pid),
    "OOMPolicy",
    "s",
    "continue",
    "MemoryMax",
    "t",
    String(memoryMax),
    "CollectMode",
    "s",
    "inactive-or-failed",
    "0",
  ]
}

/** Cheap checks first: no process is probed unless this is a Linux supervisor with a user manager of its own. */
export function planHostScope(probes: HostScopeProbes, pid: number, nonce: string): HostScopePlan | undefined {
  if (probes.platform !== "linux" || !isInternalSupervisorLaunch(probes.args)) return undefined
  if (!probes.ownsUserManager()) return undefined
  const busctl = probes.findBusctl()
  if (busctl === undefined) return undefined
  const memoryMax = probes.memTotalBytes()
  if (memoryMax === undefined) return undefined
  const unit = hostScopeUnitName(pid, nonce)
  return { busctl, unit, pid, argv: startTransientScopeArgs(unit, pid, memoryMax) }
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir === "") continue
    try {
      accessSync(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {
      continue
    }
  }
  return undefined
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/** A user manager this user owns answers on `$XDG_RUNTIME_DIR/systemd/private`; containers and sudo shells have none. */
function ownsUserManager(env: NodeJS.ProcessEnv): boolean {
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (runtimeDir === undefined || runtimeDir === "") return false
  try {
    const socket = statSync(join(runtimeDir, "systemd", "private"))
    return socket.isSocket() && socket.uid === process.getuid?.()
  } catch {
    return false
  }
}

export function liveHostScopeProbes(args: readonly string[], env: NodeJS.ProcessEnv): HostScopeProbes {
  return {
    platform: process.platform,
    args,
    ownsUserManager: () => ownsUserManager(env),
    findBusctl: () => onPath("busctl", env),
    memTotalBytes: () => memoryMaxBytes(readText("/proc/meminfo") ?? ""),
  }
}

function runBusctl(plan: HostScopePlan, env: NodeJS.ProcessEnv, deadline: number): Promise<string | undefined> {
  return new Promise((settle) => {
    const timeout = Math.max(1, deadline - Date.now())
    const child = spawn(plan.busctl, [`--timeout=${Math.ceil(timeout / 1000)}`, ...plan.argv], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      timeout,
      killSignal: "SIGKILL",
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once("error", (error) => settle(error.message))
    child.once("close", (code, signal) =>
      settle(code === 0 ? undefined : `busctl ${signal ?? `exit ${code}`}: ${stderr.trim()}`),
    )
  })
}

async function landedIn(plan: HostScopePlan, deadline: number): Promise<boolean> {
  for (;;) {
    if ((readText(`/proc/${plan.pid}/cgroup`) ?? "").includes(`/${plan.unit}`)) return true
    if (Date.now() >= deadline) return false
    await new Promise((wake) => setTimeout(wake, SCOPE_POLL_MS))
  }
}

/** Starts the plan's scope and waits, within the budget, for the pid to land in it. Never throws. */
export async function moveIntoHostScope(plan: HostScopePlan, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const deadline = Date.now() + SCOPE_BUDGET_MS
  const failure = await runBusctl(plan, env, deadline)
  if (failure !== undefined) return failure
  return (await landedIn(plan, deadline)) ? undefined : `pid ${plan.pid} did not reach ${plan.unit} in time`
}

/**
 * Awaited by the compiled entry right before a supervisor starts, so the host it spawns is born in the scope. The
 * launch continues the same way whatever happens; `OMO_DEBUG` reports why a scope was not entered.
 */
export async function enterOwnHostScope(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const plan = planHostScope(liveHostScopeProbes(args, env), process.pid, randomBytes(6).toString("hex"))
  if (plan === undefined) return
  const failure = await moveIntoHostScope(plan, env)
  if (failure !== undefined && env.OMO_DEBUG) process.stderr.write(`omo: host scope not entered: ${failure}\n`)
}
