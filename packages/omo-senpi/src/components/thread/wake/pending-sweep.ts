import type { IntakeAdmission } from "../gateway/drain"
import type { GatewayStore } from "../gateway/store"

export type PendingSweepOptions = {
  readonly store: GatewayStore
  readonly admitIntake: (device: string) => Promise<IntakeAdmission>
  readonly wake: (durableId: string) => Promise<void>
  /**
   * `session_wake.same_device` for the SESSION's own cwd (its project's configuration, 5.3): same-device rows wake
   * their session only when it is on for that session.
   */
  readonly sameDevice: (durableId: string) => boolean
}

/**
 * The pending sweep (#13037 design 5.4 step 6, 5.6 at wake): run when the consumer connects and when an engine endpoint
 * appears. A session holding open intake rows is woken once one of its senders is admitted now; the rows of a sender the
 * service refuses settle `sender_not_admitted`, and a sender with no answer leaves its rows queued for the next sweep.
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
    let wake = options.sameDevice(session.durable_id) && session.local
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
