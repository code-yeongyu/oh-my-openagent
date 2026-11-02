// omo doctor: a reflection lock held by a run that cannot finish (#10377). The decision is the one the
// session uses (memory-core reflection/stale-holder.ts), run from its generated bundle, so the two
// surfaces cannot disagree. A dead holder and a stuck one are both reported with the next step;
// a live holder or no lock prints nothing. `omo doctor --fix` (#11976) reaps exactly what the session's
// reaper would, through the same bundled code; plain `omo doctor` only reports.

import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { classifyReflectionLockHolder, decideReflectionLockReap, reapStaleReflectionLock } from "./reflection-lock.generated.js"

const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"

function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

export function classifyReflectionLock(reflectionDir, probe = {}) {
  return classifyReflectionLockHolder(reflectionDir, probe)
}

export function formatReflectionLockLines(identity, verdict, reflectionDir, reapable = false) {
  if (verdict.state === "none" || verdict.state === "live") return []
  const lock = join(reflectionDir, "active.lock")
  if (reapable) {
    return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock}, and its launcher and every recorded run process are gone. Next step: run omo doctor --fix.`]
  }
  if (verdict.state === "dead") {
    return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock}, but its launcher is gone and it already recorded its outcome. Next step: open a session and send /reflect (or any message); the session settles that run and starts any queued request.`]
  }
  return [`WARN memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock} and ${verdict.reason}. Next step: run /doctor in a session; if no reflection run is active, move ${lock} aside (keep a backup) and start a new session.`]
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

function identityReflectionDirs(options) {
  const agentsRoot = join(memoryRoot(options.env ?? process.env), "agents")
  return (options.listIdentities?.(agentsRoot) ?? listDurableIdentities(agentsRoot))
    .map((identityRoot) => ({ identity: basename(identityRoot), reflectionDir: join(identityRoot, "runtime", "reflection") }))
}

async function reportLines(identity, reflectionDir, probe) {
  const verdict = await classifyReflectionLock(reflectionDir, probe)
  if (verdict.state === "none" || verdict.state === "live") return []
  const decision = await decideReflectionLockReap(reflectionDir, probe)
  return formatReflectionLockLines(identity, verdict, reflectionDir, decision.reap)
}

export async function reflectionLockReport(options = {}) {
  const lines = []
  for (const { identity, reflectionDir } of identityReflectionDirs(options)) {
    lines.push(...await reportLines(identity, reflectionDir, options.reflectionLockProbe ?? {}))
  }
  return lines
}

export async function reflectionLockFix(options = {}) {
  const probe = options.reflectionLockProbe ?? {}
  const lines = []
  for (const { identity, reflectionDir } of identityReflectionDirs(options)) {
    const result = await reapStaleReflectionLock(reflectionDir, { probe, scope: "all" })
    if (result.state === "reaped") {
      lines.push(`PASS reaped a stale reflection lock (${identity}): run ${result.runId}, ${result.reason}; moved to ${result.movedTo}`)
    } else if (result.state === "busy") {
      lines.push(`WARN memory reflection lock (${identity}) was not checked: another process is scheduling reflection; run omo doctor --fix again`)
    } else {
      lines.push(...await reportLines(identity, reflectionDir, probe))
    }
  }
  return lines
}
