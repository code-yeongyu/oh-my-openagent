// omo doctor: a reflection lock held by a run that cannot finish (#10377). The decision is the one the
// session uses (memory-core reflection/stale-holder.ts), run from its generated bundle, so the two
// surfaces cannot disagree. A dead holder and a stuck one are both reported with the next step;
// a live holder or no lock prints nothing. `omo doctor --fix` runs the shared reaper
// (stale-lock-reaper.ts) with its minimal settle on every durable identity (#11976).

import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  classifyReflectionLockHolder,
  createRetentionHostSweepStep,
  decideStaleReflectionLock,
  decideStrandedRun,
  formatStaleLockFixLines,
  reclaimDeadOwnerLocks,
  runStaleLockReaper,
  sweepHostIdentities,
  sweepIdentityOrphanWorktrees,
} from "./reflection-lock.generated.js"
import { TASK_CONFIG_RUNTIME } from "./daemon-config.js"
import { packageRoot } from "./package-paths.js"

const requireRuntime = createRequire(import.meta.url)

const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"

function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

export function classifyReflectionLock(reflectionDir, probe = {}) {
  return classifyReflectionLockHolder(reflectionDir, probe)
}

export function decideReflectionLock(reflectionDir, probe = {}) {
  return decideStaleReflectionLock(reflectionDir, probe)
}

export function decideStrandedReflectionRun(runDir, probe = {}) {
  return decideStrandedRun(runDir, probe)
}

export function formatReflectionLockLines(identity, verdict, reflectionDir, decision) {
  if (verdict.state === "none" || verdict.state === "live") return []
  const lock = join(reflectionDir, "active.lock")
  if (verdict.state === "dead") {
    return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock}, but its launcher is gone and it already recorded its outcome. Next step: open a session and send /reflect (or any message); the session settles that run and starts any queued request.`]
  }
  if (decision?.kind === "reap") {
    return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock} and ${decision.reason}. Next step: omo doctor --fix (it would apply ${decision.action}).`]
  }
  return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock} and ${verdict.reason}. Next step: run /doctor in a session; if no reflection run is active, run omo doctor --fix.`]
}

function listDurableIdentities(agentsRoot) {
  try {
    return readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(agentsRoot, entry.name))
      .filter((identityRoot) => existsSync(join(identityRoot, "repo")))
  } catch {
    return []
  }
}

export async function reflectionLockReport(options = {}) {
  const agentsRoot = join(memoryRoot(options.env ?? process.env), "agents")
  const lines = []
  for (const identityRoot of options.listIdentities?.(agentsRoot) ?? listDurableIdentities(agentsRoot)) {
    const reflectionDir = join(identityRoot, "runtime", "reflection")
    const { verdict, decision } = await decideStaleReflectionLock(reflectionDir, options.reflectionLockProbe ?? {})
    lines.push(...formatReflectionLockLines(basename(identityRoot), verdict, reflectionDir, decision))
  }
  return lines
}

function orphanLines(identity, report, dryRun) {
  if (report.skipped !== undefined) return []
  const lines = report.removed.map((target) => `${dryRun ? "WOULD FIX" : "FIXED"} ${identity} removed orphan ${target}`)
  if (dryRun) lines.push(...report.kept.map((entry) => `KEPT ${identity} worktree ${entry.target} (${entry.reason})`))
  lines.push(...report.failed.map((entry) => `KEPT ${identity} orphan ${entry.target} (${entry.detail})`))
  return lines
}

function loadTaskConfigRuntime() {
  return requireRuntime(join(packageRoot, "plugin", TASK_CONFIG_RUNTIME))
}

// The memory settings of the user's GLOBAL omo config only (omo.jsonc, else omo.json under ~/.omo):
// `--fix` sweeps identities of every project, so it never reads a project layer (REVIEW-4 M-b). They
// are resolved by the session's own loader (`[senpi]`, `[native]`, the active profile, merged per agent
// and per runtime key) through the staged task-config runtime (task-config-entry.ts). Unreadable config
// or a runtime that cannot load means no settings, which keeps unreflected journal input.
export function readGlobalMemorySettings(home = homedir(), options = {}) {
  try {
    const runtime = (options.loadTaskConfig ?? loadTaskConfigRuntime)()
    return runtime.resolveGlobalMemorySettings({ env: { ...(options.env ?? process.env), HOME: home, USERPROFILE: home } })
  } catch {
    return undefined
  }
}

// `omo doctor --fix`: driver 1 of the host sweep (memory-core reflection/host-sweep.ts). Every identity
// with a runtime/ is visited, repo or not, resuming at the persisted cursor; a repo-less identity gets
// the reaper and the lock sweep, never the git-backed orphan sweep.
export async function reflectionLockFix(options = {}) {
  const memory = memoryRoot(options.env ?? process.env)
  const dryRun = options.dryRun === true
  const probe = options.reflectionLockProbe ?? {}
  let failed = false
  const reap = async (identity) => {
    try {
      const report = await runStaleLockReaper({ runtimeDir: identity.runtimeDir, probe, dryRun })
      const locks = dryRun ? undefined : await reclaimDeadOwnerLocks(join(identity.runtimeDir, "locks"))
      return formatStaleLockFixLines(identity.name, report, locks)
    } catch (error) {
      failed = true
      return [`FAIL ${identity.name} reflection lock fix failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  const orphans = async (identity) => {
    try {
      return orphanLines(identity.name, await sweepIdentityOrphanWorktrees(identity.root, { now: (probe.now ?? Date.now)(), dryRun }), dryRun)
    } catch (error) {
      failed = true
      return [`FAIL ${identity.name} orphan worktree sweep failed: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
  const settings = options.memorySettings ?? readGlobalMemorySettings(options.home ?? homedir(), {
    env: options.env ?? process.env,
    ...(options.loadTaskConfig === undefined ? {} : { loadTaskConfig: options.loadTaskConfig }),
  })
  const retention = createRetentionHostSweepStep({ ...(settings === undefined ? {} : { settings }), ...(probe.now === undefined ? {} : { now: probe.now }), dryRun })
  const retain = async (identity) => {
    const lines = await retention(identity)
    if (lines.some((line) => line.startsWith("FAIL "))) failed = true
    return lines
  }
  const result = await sweepHostIdentities({ memoryRoot: memory, steps: [reap, orphans, retain], dryRun })
  if (result.status === "busy") return { lines: ["INFO another sweep is running on this host; try again when it finishes"], failed: false }
  const lines = result.lines.filter((line) => !/^INFO \S+ locks reclaimed 0, kept 0$/.test(line))
  if (lines.length === 0) lines.push(dryRun ? "INFO nothing to fix" : "PASS no stale reflection locks")
  return { lines, failed }
}
