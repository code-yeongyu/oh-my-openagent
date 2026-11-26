import type { DrainWakeEvent, GatewayAdmissionKind, SessionRuntimePort, WakeReason } from "./adapter"
import { decideDelivery, effectiveLaneOf } from "./decision"
import { createClaimedAdmitter } from "./drain-admit"
import { intakeAdmissionPass, type IntakeAdmission } from "./intake-admission"
import { isLockWaitExceeded } from "./lock-wait"
import type { GatewayStore } from "./store"
import type { DeliveryRow, ProcessIdentity } from "./types"

export type { IntakeAdmission } from "./intake-admission"

export type InboxDrainResult = {
  readonly admitted: readonly { readonly delivery_id: string; readonly kind: GatewayAdmissionKind }[]
}

export type InboxDrainOptions = {
  readonly store: GatewayStore
  readonly runtime: SessionRuntimePort
  readonly durableId: string
  readonly sessionPath: () => string | null
  readonly now?: () => number
  readonly log?: (line: string) => void
  /** Shows the queued notice in the session's own UI (the extension UI `notify`). */
  readonly notify?: (text: string) => void
  /** A delivery this drain started, steered or queued into the session, with how it was admitted; runs on every pass, including a busy retry. */
  readonly onAdmitted?: (deliveryId: string, kind: "started" | "steered" | "queued") => void
  /** Asks the device service whether an intake row's sending device is admitted now (#13037 5.6); absent, no intake row is admitted. */
  readonly admitIntake?: (device: string) => Promise<IntakeAdmission>
  /** True while a woken session's row is opening under a live lease (A3.1.5): the pass admits nothing. */
  readonly wakeGated?: () => Promise<boolean>
  /** Test seams: act as another process, or stop between the two phases of an admission. */
  readonly _test?: {
    readonly identity?: ProcessIdentity
    readonly afterClaim?: (row: DeliveryRow) => void
    readonly afterAdmit?: (row: DeliveryRow, kind: string) => void
  }
}

export type InboxDrain = {
  readonly drain: (event: DrainWakeEvent) => Promise<InboxDrainResult>
  readonly isSessionReferenced: () => Promise<boolean>
  readonly heldDeliveries: () => ReadonlyMap<string, number>
  /** Cancels a pending busy retry; the drain is being retired. */
  readonly stop: () => void
}

/** The notice a session shows when a delivery waits behind its running turn or the user's draft. */
export function queuedNotice(row: Pick<DeliveryRow, "delivery_id" | "envelope">): string {
  return `remote message from ${row.envelope.actor} queued (${row.delivery_id})`
}

const RELEASING_REASONS: ReadonlySet<WakeReason> = new Set(["submission", "draft_cleared", "idle", "start", "continue"])

/**
 * Receiver half: the only path that moves a row out of `queued`. Each pass starts with the store's
 * `BEGIN IMMEDIATE` barrier (`reconcile`), then admits queued rows in seq order with a two-phase
 * claim - T1 claims the row, the runtime call runs outside any transaction, T2 records the
 * outcome. A row becomes `applied` only in a later barrier pass, once the runtime ledger reports
 * its transcript entry as `emitted`. A held row (the user is composing) costs no store write and
 * stops the pass, so nothing behind it overtakes it; it is looked at again only on an edge that
 * can release it, or when the editor revision changed.
 */
export function createInboxDrain(options: InboxDrainOptions): InboxDrain {
  const now = options.now ?? options.store.now
  const held = new Map<string, number>()
  const noticed = new Set<string>()
  let chain: Promise<unknown> = Promise.resolve()

  function noticeQueued(row: DeliveryRow): void {
    if (options.notify === undefined || noticed.has(row.delivery_id)) return
    noticed.add(row.delivery_id)
    options.notify(queuedNotice(row))
  }

  async function identity(): Promise<ProcessIdentity> {
    return options._test?.identity ?? (await options.store.identity())
  }

  async function pass(event: DrainWakeEvent): Promise<InboxDrainResult> {
    const self = await identity()
    const runtime = options.runtime
    const reconciled = await options.store.reconcile({
      now: now(),
      target_durable_id: options.durableId,
      self,
      ledger: runtime.listAdmittedDeliveries(),
      session_path: options.sessionPath(),
    })
    for (const id of reconciled.dual_runtime)
      options.log?.(`dual_runtime: delivery ${id} is claimed by another live process for ${options.durableId}`)
    const admitted: { delivery_id: string; kind: GatewayAdmissionKind }[] = []
    for (const id of held.keys()) if (!reconciled.queued.some((row) => row.delivery_id === id)) held.delete(id)
    if ((await options.wakeGated?.()) === true) {
      for (const row of reconciled.queued) admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
      return { admitted }
    }
    const admission = intakeAdmissionPass(options.admitIntake)
    const admitClaimed = createClaimedAdmitter({
      store: options.store,
      runtime,
      durableId: options.durableId,
      self,
      now,
      admitted,
      held,
      noticeQueued,
      ...(options.log === undefined ? {} : { log: options.log }),
      ...(options.onAdmitted === undefined ? {} : { onAdmitted: options.onAdmitted }),
      ...(options._test?.afterAdmit === undefined ? {} : { afterAdmit: options._test.afterAdmit }),
    })
    // The pass's first row that would start the idle session is admitted last, after every later row of the pass has
    // joined it, so that one start carries them all.
    let heldStart: { readonly row: DeliveryRow; readonly claimed: DeliveryRow } | undefined
    for (const [index, row] of reconciled.queued.entries()) {
      const gate = runtime.admissionGate()
      const heldRevision = held.get(row.delivery_id)
      if (heldRevision !== undefined && !RELEASING_REASONS.has(event.reason) && heldRevision === gate.editor_revision) {
        admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
        break
      }
      if (!gate.can_admit) {
        held.set(row.delivery_id, gate.editor_revision)
        noticeQueued(row)
        admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
        break
      }
      held.delete(row.delivery_id)
      const verdict = await admission(row)
      if (verdict === "skip") continue
      if (verdict === "refuse") {
        await options.store.refuseQueued({ now: now(), delivery_id: row.delivery_id, reason: "sender_not_admitted" })
        admitted.push({ delivery_id: row.delivery_id, kind: "sender_not_admitted" })
        continue
      }
      const decision = decideDelivery(runtime.phase(), row.mode_requested, row.expected_turn_id, gate.turn_epoch)
      if (decision.kind !== "admit") {
        const reason = decision.kind === "refuse" ? decision.reason : "turn_conflict"
        await options.store.refuseQueued({ now: now(), delivery_id: row.delivery_id, reason })
        admitted.push({ delivery_id: row.delivery_id, kind: reason })
        continue
      }
      const starts = decision.expect === "started"
      const claimed = await options.store.claim({
        now: now(),
        delivery_id: row.delivery_id,
        self,
        lane: starts && heldStart !== undefined ? "steer" : effectiveLaneOf(decision),
      })
      if (claimed.kind !== "claimed") continue
      options._test?.afterClaim?.(claimed.row)
      // A run that began while the pass waited on the store takes the held start first, so the session still sees the
      // rows in seq order.
      if (heldStart !== undefined && runtime.phase() !== "idle") {
        const first = heldStart
        heldStart = undefined
        if ((await admitClaimed(first.row, first.claimed, {})) === "stop") break
      }
      if (starts && heldStart === undefined && index < reconciled.queued.length - 1 && runtime.phase() === "idle") {
        heldStart = { row, claimed: claimed.row }
        continue
      }
      const step = await admitClaimed(row, claimed.row, heldStart === undefined ? {} : { joinsStart: true })
      if (step === "stop") break
    }
    if (heldStart !== undefined) await admitClaimed(heldStart.row, heldStart.claimed, {})
    const order = new Map(reconciled.queued.map((row, index) => [row.delivery_id, index]))
    admitted.sort((a, b) => (order.get(a.delivery_id) ?? 0) - (order.get(b.delivery_id) ?? 0))
    return { admitted }
  }

  // The protocol's single busy timer: a pass that gave up at the store's lock-wait bound (a writer
  // suspended while holding the lock) re-arms exactly one retry of the same wake after busy_timeout,
  // until a pass gets through. Nothing holds the store worker between attempts.
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  function run(event: DrainWakeEvent): Promise<InboxDrainResult> {
    const next = chain.then(() => pass(event))
    chain = next.catch(() => undefined)
    next.then(
      () => {
        clearTimeout(retry)
        retry = undefined
      },
      (error: unknown) => {
        if (!isLockWaitExceeded(error) || stopped || retry !== undefined) return
        options.log?.(
          `drain for ${options.durableId} is waiting on the store's write lock; retrying in ${options.store.busyTimeoutMs} ms`,
        )
        retry = setTimeout(() => {
          retry = undefined
          if (!stopped) void run(event).catch(() => undefined)
        }, options.store.busyTimeoutMs)
        retry.unref?.()
      },
    )
    return next
  }

  return {
    drain: run,
    isSessionReferenced: () => options.store.isReferenced(options.durableId),
    heldDeliveries: () => held,
    stop: () => {
      stopped = true
      clearTimeout(retry)
      retry = undefined
    },
  }
}
