// omo doctor: a reflection lock held by a run that cannot finish (#10377). The decision is the one the
// session uses (memory-core reflection/stale-holder.ts), run from its generated bundle, so the two
// surfaces cannot disagree. A dead holder and a stuck one are both reported with the next step;
// a live holder or no lock prints nothing. `omo doctor --fix` runs the shared reaper
// (stale-lock-reaper.ts) with its minimal settle on every durable identity (#11976).

import { existsSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { finding, renderFixEntries } from "./diagnostics-findings.js"
import { fixReflectionLock } from "./diagnostics-repairs.js"
import {
  classifyReflectionLockHolder,
  decideStaleReflectionLock,
  decideStrandedRun,
} from "./reflection-lock.generated.js"
import { memoryRoot } from "./reflection-lock-sweep.js"

export function classifyReflectionLock(reflectionDir, probe = {}) {
  return classifyReflectionLockHolder(reflectionDir, probe)
}

export function decideReflectionLock(reflectionDir, probe = {}) {
  return decideStaleReflectionLock(reflectionDir, probe)
}

export function decideStrandedReflectionRun(runDir, probe = {}) {
  return decideStrandedRun(runDir, probe)
}

export function reflectionLockFindings(identity, verdict, reflectionDir, decision) {
  if (verdict.state === "none" || verdict.state === "live") return []
  const lock = join(reflectionDir, "active.lock")
  const details = { identity, run_id: verdict.runId, lock, state: verdict.state }
  if (verdict.state === "dead") {
    return [
      finding(
        "memory.reflection-lock",
        "warn",
        `memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock}, but its launcher is gone and it already recorded its outcome. Next step: open a session and send /reflect (or any message); the session settles that run and starts any queued request.`,
        { ...details, next: "session" },
      ),
    ]
  }
  if (decision?.kind === "reap") {
    return [
      finding(
        "memory.reflection-lock",
        "warn",
        `memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock} and ${decision.reason}. Next step: omo doctor --fix (it would apply ${decision.action}).`,
        { ...details, next: "fix", reason: decision.reason, action: decision.action },
      ),
    ]
  }
  return [
    finding(
      "memory.reflection-lock",
      "warn",
      `memory reflection is stuck on a stale lock (${identity}): run ${verdict.runId} still holds ${lock} and ${verdict.reason}. Next step: run /doctor in a session; if no reflection run is active, run omo doctor --fix.`,
      { ...details, next: "doctor", reason: verdict.reason },
    ),
  ]
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
    lines.push(...reflectionLockFindings(basename(identityRoot), verdict, reflectionDir, decision))
  }
  return lines
}

// `omo doctor --fix [--dry-run]` as the command prints it: the diagnostics core's sweep, rendered.
export async function reflectionLockFix(options = {}) {
  const { dryRun, ...ports } = options
  const result = await fixReflectionLock({ dry_run: dryRun === true }, ports)
  if (result.kind === "error") return { lines: [`FAIL ${result.error.message}`], failed: true }
  return { lines: renderFixEntries(result.value.entries), failed: result.value.failed }
}
