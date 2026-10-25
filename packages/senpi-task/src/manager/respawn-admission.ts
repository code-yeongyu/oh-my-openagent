import type { AdmissionBarrier, ResumeCredential } from "../pause/admission-barrier"
import type { RespawnResult } from "../lifecycle/port"
import type { TaskRecord } from "../state"

class RespawnHeld extends Error {
  constructor() { super("run admission is held") }
}

const runPaused = (record: TaskRecord): RespawnResult => ({
  ok: false, disposition: "retryable", code: "run_paused",
  reason: `Task ${record.task_id} belongs to a stopped run; it is not launched until the run resumes.`,
})

/**
 * A respawn is an execution producer (design 5.2): it takes its run's admission ticket before its
 * first await and checks it again at the launch boundary, where a Stop that landed meanwhile refuses
 * the launch. Only the run's own Resume (its credential) may respawn a child while it is resuming.
 */
export async function admitRespawn(
  barrier: AdmissionBarrier,
  record: TaskRecord,
  credential: ResumeCredential | undefined,
  respawn: (checkLaunch: () => void) => Promise<RespawnResult>,
  startsPaused = false,
): Promise<RespawnResult> {
  // A child restored paused starts nothing: it is the barrier's own "launch already paused" commit.
  if (startsPaused) return respawn(() => undefined)
  const runRef = record.owner === undefined ? { kind: "task" as const, id: record.task_id } : { kind: "dag" as const, id: record.owner.runId }
  const entered = barrier.enter(record.root_session_id ?? record.parent_session_id, { key: record.task_id, runRef }, credential)
  if (entered.kind === "held") return runPaused(record)
  let held = false
  try {
    const result = await respawn(() => {
      if (entered.ticket.check().kind !== "held") return
      held = true
      throw new RespawnHeld()
    })
    return held && !result.ok ? runPaused(record) : result
  } finally {
    entered.ticket.leave()
  }
}
