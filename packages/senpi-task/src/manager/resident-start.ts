import { acquireSessionAdmissionLease } from "../lifecycle/admission-lease"
import type { StartResult, TaskManagerOptions } from "./types"

// Normal spawns and pool grants share the same admission lease. Release at the persisted-record
// boundary: the record now counts as resident, and runner I/O never holds the session gate.
export async function withResidentStart(
  options: TaskManagerOptions,
  parentSessionId: string,
  start: (release: () => void) => Promise<StartResult>,
): Promise<StartResult> {
  if (options.admit === undefined) return start(() => undefined)
  const acquired = await acquireSessionAdmissionLease(options.store.stateDir, parentSessionId)
  if (acquired.kind === "contended") {
    return { kind: "residency_denied", reason: "Residency admission is contended.", cause: "lease" }
  }
  let released = false
  const release = (): void => { if (!released) { released = true; acquired.lease.release() } }
  try {
    const admission = await options.admit(parentSessionId)
    if (admission.kind === "rejected") {
      return {
        kind: "residency_denied",
        reason: admission.message,
        cause: "residents",
        ...(admission.max_children === undefined ? {} : { max_children: admission.max_children }),
        residents: admission.residents ?? [],
      }
    }
    if (!acquired.lease.isOwner()) {
      return { kind: "residency_denied", reason: "Residency admission lease was displaced.", cause: "lease" }
    }
    return await start(release)
  } finally { release() }
}
