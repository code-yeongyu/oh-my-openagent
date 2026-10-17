import type { TeamModeConfig } from "../../config/schema/team-mode"
import { spawn } from "../../shared/bun-spawn-shim"

export interface TeamModeDependencyReport {
  tmuxAvailable: boolean
  gitAvailable: boolean
}

type Spawn = typeof spawn

type TeamModeDependencyDeps = {
  readonly spawn?: Spawn
  readonly tmuxEnv?: string
  readonly probeTimeoutMs?: number
  readonly now?: () => number
}

export async function checkTeamModeDependencies(
  config: TeamModeConfig,
  deps: TeamModeDependencyDeps = {},
): Promise<TeamModeDependencyReport> {
  const spawnImpl = deps.spawn ?? spawn
  const timeoutMs = deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS
  const now = deps.now ?? Date.now
  const probe = (cmd: string, args: string[]): Promise<boolean> =>
    deps.spawn === undefined
      ? probeBinaryShared(cmd, args, spawnImpl, timeoutMs, now)
      : probeBinary(cmd, args, spawnImpl, timeoutMs).then((outcome) => outcome === "available")
  const tmuxEnv = deps.tmuxEnv ?? process.env["TMUX"]
  const tmuxAvailable = Boolean(tmuxEnv) || (await probe("tmux", ["-V"]))
  const gitAvailable = await probe("git", ["--version"])
  if (config.tmux_visualization && !tmuxAvailable) {
    console.warn(
      "[team-mode] tmux_visualization=true but tmux not available; layout will be skipped at runtime",
    )
  }
  return { tmuxAvailable, gitAvailable }
}

// Local fix 47: binary availability rarely changes between chat folders, but each probe is a child-process
// spawn on the setup path of every new folder. Default-spawner probes are shared per process, keyed by the
// executable search path, with an explicit policy:
//   - every probe has a deadline; a probe that does not exit in time is killed and reported unavailable,
//     so callers always settle and a wedged executable cannot hold later folder setups;
//   - concurrent callers share one in-flight probe;
//   - "available" is remembered for the process (per PATH);
//   - a definite "unavailable" (non-zero exit, spawn failure) is remembered for NEGATIVE_TTL_MS, then retried;
//   - a timeout is never remembered: the next caller probes again.
const PROBE_TIMEOUT_MS = 3_000
const NEGATIVE_TTL_MS = 5 * 60_000

type ProbeOutcome = "available" | "unavailable" | "timeout"
type SharedProbe = { readonly pending?: Promise<boolean>; readonly available?: boolean; readonly until?: number }

const sharedProbes = new Map<string, SharedProbe>()

function probeKey(cmd: string, args: string[]): string {
  return `${process.env.PATH ?? process.env.Path ?? ""}\0${[cmd, ...args].join(" ")}`
}

function probeBinaryShared(
  cmd: string,
  args: string[],
  spawnImpl: Spawn,
  timeoutMs: number,
  now: () => number,
): Promise<boolean> {
  const key = probeKey(cmd, args)
  const entry = sharedProbes.get(key)
  if (entry?.pending !== undefined) return entry.pending
  if (entry?.available === true) return Promise.resolve(true)
  if (entry?.available === false && entry.until !== undefined && now() < entry.until) return Promise.resolve(false)
  const pending = probeBinary(cmd, args, spawnImpl, timeoutMs).then((outcome) => {
    if (outcome === "available") sharedProbes.set(key, { available: true })
    else if (outcome === "unavailable") sharedProbes.set(key, { available: false, until: now() + NEGATIVE_TTL_MS })
    else sharedProbes.delete(key)
    return outcome === "available"
  })
  sharedProbes.set(key, { pending })
  return pending
}

/** Test hook: forget every shared probe result. */
export function resetTeamModeProbeCache(): void {
  sharedProbes.clear()
}

async function probeBinary(cmd: string, args: string[], spawnImpl: Spawn, timeoutMs: number): Promise<ProbeOutcome> {
  let proc: ReturnType<Spawn>
  try {
    proc = spawnImpl({ cmd: [cmd, ...args], stdout: "pipe", stderr: "pipe" })
  } catch (error) {
    error instanceof Error
    return "unavailable"
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
  })
  try {
    const result = await Promise.race([
      proc.exited.then((code): ProbeOutcome => (code === 0 ? "available" : "unavailable")),
      deadline,
    ])
    if (result === "timeout") {
      try {
        proc.kill?.()
      } catch (error) {
        error instanceof Error
      }
    }
    return result
  } catch (error) {
    error instanceof Error
    return "unavailable"
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
