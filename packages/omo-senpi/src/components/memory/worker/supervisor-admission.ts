import { join } from "node:path"
import { acquireReflectionRunLease, resolveMemoryRoot } from "@oh-my-opencode/memory-core"
import { readRunJson, updateRunLedger, writeRunJsonAtomic, type RunLaunchManifest } from "./run-artifacts"
import { getSupervisorProcessStart, readSupervisorClockNow } from "./supervisor-process-identity"

export async function admitSupervisor(runDir: string) {
  const launchPath = join(runDir, "launch.json")
  const ledgerPath = join(runDir, "ledger.json")
  const initial = await readRunJson<RunLaunchManifest>(launchPath)
  const queuedAt = initial.queuedAt ?? readSupervisorClockNow()
  await updateRunLedger(ledgerPath, {
    launching: false, queued: true,
    pid: process.pid, processStart: await getSupervisorProcessStart(process.pid),
  })
  const root = initial.memoryRoot ?? resolveMemoryRoot(initial.env, initial.cwd)
  const lease = await acquireReflectionRunLease(join(root, "runtime", "locks"), initial.maxConcurrentRuns)
  try {
    const admittedAt = readSupervisorClockNow()
    if (!Number.isFinite(queuedAt) || !Number.isFinite(admittedAt)) throw new Error("unreadable reflection admission clock")
    const hardDeadlineAt = initial.hardDeadlineAt + Math.max(0, admittedAt - queuedAt)
    const manifest = { ...initial, hardDeadlineAt }
    // No child exists until BOTH files agree. A crash here leaves queued=true and a dead owner.
    await writeRunJsonAtomic(launchPath, manifest)
    await updateRunLedger(ledgerPath, {
      queued: false, hardDeadlineAt, deadlineAt: hardDeadlineAt + initial.terminationGraceMs,
    })
    return { manifest, lease }
  } catch (error) {
    await lease.release()
    throw error
  }
}
