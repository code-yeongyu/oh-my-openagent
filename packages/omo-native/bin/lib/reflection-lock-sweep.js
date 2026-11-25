// `omo doctor --fix`'s host sweep over every memory identity (memory-core reflection/host-sweep.ts), run from the
// committed memory-core bundle so the doctor and the session decide alike.
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  createRetentionHostSweepStep,
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

/** @param {Readonly<Record<string, string | undefined>>} env */
export function memoryRoot(env, home = homedir()) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(home, ".omo", "memory")
  return resolve(process.cwd(), override)
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
    return runtime.resolveGlobalMemorySettings({
      env: { ...(options.env ?? process.env), HOME: home, USERPROFILE: home },
    })
  } catch {
    return undefined
  }
}

// `omo doctor --fix`: driver 1 of the host sweep (memory-core reflection/host-sweep.ts). Every identity
// with a runtime/ is visited, repo or not, resuming at the persisted cursor; a repo-less identity gets
// the reaper and the lock sweep, never the git-backed orphan sweep.
// The sweep's own lines are memory-core's text (its step type answers lines), so they travel verbatim; `failed` is the one
// derivation `omo doctor --fix`'s exit code has always used: a step that threw, or a retention line that failed.
/** @returns {Promise<{ status: "busy" | "swept", lines: string[], failed: boolean }>} */
export async function reflectionLockSweep(options = {}) {
  const memory = memoryRoot(options.env ?? process.env, options.home)
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
      return [
        `FAIL ${identity.name} reflection lock fix failed: ${error instanceof Error ? error.message : String(error)}`,
      ]
    }
  }
  const orphans = async (identity) => {
    try {
      return orphanLines(
        identity.name,
        await sweepIdentityOrphanWorktrees(identity.root, { now: (probe.now ?? Date.now)(), dryRun }),
        dryRun,
      )
    } catch (error) {
      failed = true
      return [
        `FAIL ${identity.name} orphan worktree sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      ]
    }
  }
  const settings =
    options.memorySettings ??
    readGlobalMemorySettings(options.home ?? homedir(), {
      env: options.env ?? process.env,
      ...(options.loadTaskConfig === undefined ? {} : { loadTaskConfig: options.loadTaskConfig }),
    })
  const retention = createRetentionHostSweepStep({
    ...(settings === undefined ? {} : { settings }),
    ...(probe.now === undefined ? {} : { now: probe.now }),
    dryRun,
  })
  const retain = async (identity) => {
    const lines = await retention(identity)
    if (lines.some((line) => line.startsWith("FAIL "))) failed = true
    return lines
  }
  const result = await sweepHostIdentities({ memoryRoot: memory, steps: [reap, orphans, retain], dryRun })
  if (result.status === "busy") return { status: "busy", lines: [], failed: false }
  const lines = result.lines.filter((line) => !/^INFO \S+ locks reclaimed 0, kept 0$/.test(line))
  return { status: "swept", lines, failed }
}
