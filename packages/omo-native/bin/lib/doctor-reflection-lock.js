// omo doctor: a reflection lock held by a run that cannot finish (#10377). The decision is the one the
// session uses (memory-core reflection/stale-holder.ts), run from its generated bundle, so the two
// surfaces cannot disagree. A dead holder and a stuck one are both reported with the next step;
// a live holder or no lock prints nothing.

import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { classifyReflectionLockHolder } from "./reflection-lock.generated.js"

const MEMORY_ROOT_ENV_VAR = "OMO_MEMORY_HOME"

function memoryRoot(env) {
  const override = env[MEMORY_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") return join(homedir(), ".omo", "memory")
  return resolve(process.cwd(), override)
}

export function classifyReflectionLock(reflectionDir, probe = {}) {
  return classifyReflectionLockHolder(reflectionDir, probe)
}

export function formatReflectionLockLines(identity, verdict, reflectionDir) {
  if (verdict.state === "none" || verdict.state === "live") return []
  const lock = join(reflectionDir, "active.lock")
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

export async function reflectionLockReport(options = {}) {
  const agentsRoot = join(memoryRoot(options.env ?? process.env), "agents")
  const lines = []
  for (const identityRoot of options.listIdentities?.(agentsRoot) ?? listDurableIdentities(agentsRoot)) {
    const reflectionDir = join(identityRoot, "runtime", "reflection")
    const verdict = await classifyReflectionLock(reflectionDir, options.reflectionLockProbe ?? {})
    lines.push(...formatReflectionLockLines(basename(identityRoot), verdict, reflectionDir))
  }
  return lines
}
