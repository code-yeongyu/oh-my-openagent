import type { DrainWakeEvent, GatewayAdmissionKind, SessionRuntimePort, WakeReason } from "./adapter"
import { decideDelivery } from "./decision"
import { renderDeliveryText } from "./provenance"
import type { GatewayStore } from "./store"
import type { DeliveryRow, ProcessIdentity } from "./types"

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
  const now = options.now ?? Date.now
  const held = new Map<string, number>()
  let chain: Promise<unknown> = Promise.resolve()

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
    for (const id of reconciled.dual_runtime) options.log?.(`dual_runtime: delivery ${id} is claimed by another live process for ${options.durableId}`)
    const admitted: { delivery_id: string; kind: GatewayAdmissionKind }[] = []
    for (const id of held.keys()) if (!reconciled.queued.some((row) => row.delivery_id === id)) held.delete(id)
    for (const row of reconciled.queued) {
      const gate = runtime.admissionGate()
      const heldRevision = held.get(row.delivery_id)
      if (heldRevision !== undefined && !RELEASING_REASONS.has(event.reason) && heldRevision === gate.editor_revision) break
      if (!gate.can_admit) {
        held.set(row.delivery_id, gate.editor_revision)
        admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
        break
      }
      held.delete(row.delivery_id)
      const decision = decideDelivery(runtime.phase(), row.mode_requested, row.expected_turn_id, gate.turn_epoch)
      if (decision.kind !== "admit") {
        const reason = decision.kind === "refuse" ? decision.reason : "turn_conflict"
        await options.store.refuseQueued({ now: now(), delivery_id: row.delivery_id, reason })
        admitted.push({ delivery_id: row.delivery_id, kind: reason })
        continue
      }
      const claimed = await options.store.claim({ now: now(), delivery_id: row.delivery_id, self, lane: decision.deliverAs === "steer" ? "steer" : "follow_up" })
      if (claimed.kind !== "claimed") continue
      options._test?.afterClaim?.(claimed.row)
      let result: ReturnType<SessionRuntimePort["admitExternalMessage"]>
      try {
        result = runtime.admitExternalMessage({
          delivery_id: row.delivery_id,
          text: renderDeliveryText(claimed.row),
          deliverAs: decision.deliverAs,
          ...(decision.expected_turn_id === undefined ? {} : { expected_turn_id: decision.expected_turn_id }),
        })
      } catch (error) {
        await options.store.recordOutcome({ now: now(), delivery_id: row.delivery_id, self, outcome: { kind: "requeue" } })
        options.log?.(`admission closed for ${options.durableId}: ${error instanceof Error ? error.message : String(error)}`)
        break
      }
      options._test?.afterAdmit?.(claimed.row, result.kind)
      if (result.kind === "held_draft") {
        await options.store.recordOutcome({ now: now(), delivery_id: row.delivery_id, self, outcome: { kind: "requeue" } })
        held.set(row.delivery_id, runtime.admissionGate().editor_revision)
        admitted.push({ delivery_id: row.delivery_id, kind: "held_draft" })
        break
      }
      if (result.kind === "turn_conflict") {
        await options.store.recordOutcome({ now: now(), delivery_id: row.delivery_id, self, outcome: { kind: "refused", reason: "turn_conflict" } })
      } else {
        const written = result.kind === "already_admitted" && runtime.listAdmittedDeliveries().emitted.includes(row.delivery_id)
        await options.store.recordOutcome({
          now: now(),
          delivery_id: row.delivery_id,
          self,
          outcome: { kind: written ? "applied" : "admitted", admission_kind: result.kind, turn_epoch: result.turn_epoch },
        })
      }
      admitted.push({ delivery_id: row.delivery_id, kind: result.kind })
    }
    return { admitted }
  }

  return {
    drain: (event) => {
      const next = chain.then(() => pass(event))
      chain = next.catch(() => undefined)
      return next
    },
    isSessionReferenced: () => options.store.isReferenced(options.durableId),
    heldDeliveries: () => held,
  }
}
