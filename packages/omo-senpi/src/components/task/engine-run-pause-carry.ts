import { randomUUID } from "node:crypto"
import type { RequesterChannel } from "../../../../senpi-task/src/control/requester-channel"
import type { RunPauseOwner } from "../../../../senpi-task/src/pause/ports"
import type { PauseParticipant, PauseRegistry } from "../../../../senpi-task/src/pause/registry"
import { inRemoteClass } from "../../../../senpi-task/src/pause/remote-participants"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { SendOutcome } from "../../../../senpi-task/src/steering"

const GUIDANCE_MAX_ENTRIES = 8
const GUIDANCE_MAX_BYTES = 1024
const GUIDANCE_TOO_LARGE = "this message is too long to carry to the process that owns this child"

const refused = (taskId: string, reason: string, suggestion: string): SendOutcome => ({ kind: "not_continuable", task_id: taskId, reason, suggestion })

// A person's message to a child another live process owns, while this run is stopped (design 3.2):
// carried in the child's register guidance and delivered by the owner before the resume. The ledger
// participant is the durable home of the entry; the register is derived from it.
export function createGuidanceCarry(ports: { readonly channel: RequesterChannel; readonly registry: PauseRegistry }) {
  return {
    ownedElsewhere: (record: TaskRecord): boolean => ports.channel.ownedElsewhere(record),
    async carry(record: TaskRecord, owner: RunPauseOwner, text: string): Promise<SendOutcome> {
      const taskId = record.task_id
      const reason = ports.channel.cannotApply(record)
      if (reason !== undefined) return refused(taskId, `owner_cannot_apply: ${reason} - task ${taskId} is running in another omo process (pid ${record.host_pid ?? "unknown"}) that cannot take this message from here; nothing was delivered.`,
        "Send it from that process, or once that process restarts or exits.")
      const entry = { inputId: `send-${randomUUID()}`, revision: 0, text }
      const ledger = ports.registry.load(owner.parentSessionId)
      const prior: PauseParticipant | undefined = ledger?.participants[taskId]
      const guidance = [...(prior?.guidance ?? []), entry]
      if (Buffer.byteLength(text, "utf8") > GUIDANCE_MAX_BYTES || guidance.length > GUIDANCE_MAX_ENTRIES) {
        return refused(taskId, `guidance_too_large: ${GUIDANCE_TOO_LARGE}`, "Send a shorter message.")
      }
      const added = ports.registry.add(owner.parentSessionId, owner.parentPauseSeq, {
        ...prior, key: taskId, taskId, runRef: prior?.runRef ?? owner.runRef, runEpoch: record.notification.run_epoch,
        kind: prior?.kind ?? (owner.runRef.kind === "dag" ? "dag_node" : "task"),
        state: prior !== undefined && inRemoteClass(prior) ? prior.state : "owned_elsewhere",
        ownerPid: record.host_pid ?? 0, guidance, at: record.updated_at,
      })
      if (!added) return refused(taskId, `Task ${taskId} could not join the stopped run; nothing was delivered.`, "Resume the run, then send again.")
      ports.channel.assertDesired({ taskId, runEpoch: record.notification.run_epoch, parentSessionId: owner.parentSessionId,
        pauseSeq: owner.parentPauseSeq, runRef: prior?.runRef ?? owner.runRef, phase: "paused", guidance })
      return { kind: "held", task_id: taskId, pause_seq: owner.parentPauseSeq, entry_id: entry.inputId }
    },
  }
}

export type GuidanceCarry = ReturnType<typeof createGuidanceCarry>
