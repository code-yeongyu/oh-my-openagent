import type { IntakeAdmission } from "../gateway/drain"
import type { GatewayStore } from "../gateway/store"
import { settleClosedIntake } from "./closed-intake"

export type PendingSweepOptions = {
  readonly store: GatewayStore
  readonly admitIntake: (device: string) => Promise<IntakeAdmission>
  readonly wake: (durableId: string) => Promise<void>
  /**
   * `session_wake.same_device` for the SESSION's own cwd (its project's configuration, 5.3): same-device rows wake
   * their session only when it is on for that session.
   */
  readonly sameDevice: (durableId: string) => boolean
  /** When the session was last closed on request (`session-target.ts` `closed_at`); undefined when never (#14273). */
  readonly closedAt: (durableId: string) => number | undefined
}

/**
 * The pending sweep (#13037 design 5.4 step 6, 5.6 at wake): run when the consumer connects and when an engine endpoint
 * appears. A session holding open intake rows is woken once one of its senders is admitted now; the rows of a sender the
 * service refuses settle `sender_not_admitted`, and a sender with no answer leaves its rows queued for the next sweep.
 * Rows queued before the session was closed on request settle `target_closed` first, so a close is never undone by a
 * message that was waiting when it happened (#14273); a session left with nothing queued is not woken.
 */
export async function runPendingSweep(options: PendingSweepOptions): Promise<void> {
  const { store } = options
  const answers = new Map<string, IntakeAdmission>()
  const admission = async (device: string): Promise<IntakeAdmission> => {
    let answer = answers.get(device)
    if (answer === undefined) {
      answer = await options.admitIntake(device).catch((): IntakeAdmission => "unknown")
      answers.set(device, answer)
    }
    return answer
  }
  for (const session of await store.intakeMarks.openSessions()) {
    const closedAt = options.closedAt(session.durable_id)
    if (closedAt !== undefined && (await settleClosedIntake(store, session.durable_id, closedAt)).length === 0) continue
    // Local first: a session that is not local can never wake this way, so its project's setting is never read.
    let wake = session.local && options.sameDevice(session.durable_id)
    for (const device of session.devices) {
      const answer = await admission(device)
      if (answer === "admitted") wake = true
      if (answer !== "refused") continue
      for (const row of await store.list({ target_durable_id: session.durable_id }))
        if (row.state === "queued" && row.ledger_id?.startsWith(`device:${device}/`) === true)
          await store.refuseQueued({ now: store.now(), delivery_id: row.delivery_id, reason: "sender_not_admitted" })
    }
    if (wake) await options.wake(session.durable_id)
  }
}
