// Rotation on revoke (sync-design section 7; #12280 design section 3.1). A revoke, a sign-out or a
// recovery-key removal makes the service set `rotation_pending` and refuse every push `stale_base`
// until a member appends a rotation that excludes every revoked principal. Any eligible member does
// it, racing on the sequencer: the loser reads `stale_base`, discards its key and adopts the
// winner's. The device list only subtracts members, wraps go only to principals of the verified fold,
// and a rotation counts as landed only once this device's verified chain shows it. Key material is
// zeroed on every exit.

import type { ChainState } from "../crypto/chain.ts"
import type { Head } from "../crypto/entry.ts"
import type { FreezeOutcome, FreezeReason, FreezeSettler } from "../engine/ports.ts"
import { staleBackoffMs } from "../engine/push.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { ownMaterial, rotationAppend } from "../recovery/keyring-append.ts"
import type { EpochMaterial } from "../recovery/key-material.ts"
import { committedWrap, expectedHistory } from "../recovery/served-chain.ts"
import type { AccountChain } from "./account-chain.ts"
import {
  atServedHead,
  chainGate,
  revokedGrew,
  rotationMembers,
  type SettleMemory,
  unchangedSince,
  viewGate,
} from "./freeze-eligibility.ts"
import type { AccountHttp } from "./http.ts"
import type { RevocationView } from "./revocation-view.ts"

export type FreezeEvent =
  | "sync.keyring.rotated"
  | "sync.keyring.rotation_adopted"
  | "sync.keyring.rotation_refused"
  | "sync.keyring.unverified"
  | "sync.keyring.member_unlisted"

export type FreezeFaultPoint = "after-state-read" | "after-devices-read" | "before-append"

export interface FreezeSettlerInput {
  readonly chain: AccountChain
  readonly http: Pick<AccountHttp, "state" | "appendKeys">
  readonly keyring: DeviceKeyring
  readonly revocationView: () => Promise<RevocationView>
  /** One account on one device: the in-process single-flight and the rule-7 memory are keyed by it. */
  readonly scope: string
  readonly onEvent?: (event: FreezeEvent) => void
  /** Test-only: awaited at the named points so a test can admit a competing record first. */
  readonly fault?: (point: FreezeFaultPoint) => Promise<void>
  readonly sleep?: (ms: number) => Promise<void>
}

const ATTEMPTS = 3
const inFlight = new Map<string, Promise<FreezeOutcome>>()
const rotated = new Map<string, SettleMemory>()
const refused = new Map<string, SettleMemory>()

const frozen = (reason: FreezeReason): FreezeOutcome => ({ kind: "frozen", reason })

const zero = (material: EpochMaterial): void => {
  material.current.fill(0)
  for (const row of material.history) row.key.fill(0)
}

const sameMembers = (state: ChainState, ids: ReadonlySet<string>): boolean =>
  state.authority !== null &&
  state.authority.members.size === ids.size &&
  [...ids].every((id) => state.authority?.members.has(id) === true)

export function createFreezeSettler(input: FreezeSettlerInput): FreezeSettler {
  const { chain, http, keyring, scope } = input
  const fault = async (point: FreezeFaultPoint) => input.fault?.(point)
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const self = { id: keyring.principal().id, signing: keyring.publicKeys().signing }

  // One attempt at the served head: rotate with the material this device opened from its own wrap.
  const attempt = async (
    served: Head,
    material: EpochMaterial,
    view: RevocationView & { readonly kind: "usable" },
    state: ChainState,
  ): Promise<FreezeOutcome | "stale" | "reread"> => {
    const authority = state.authority
    const head = state.head
    if (authority === null || head === null) return frozen("unverified")
    if (unchangedSince(rotated.get(scope), served.keyring_link, view.revoked)) return frozen("flag_stuck")
    if (unchangedSince(refused.get(scope), served.keyring_link, view.revoked)) return frozen("refused")
    const { members, unlisted } = rotationMembers(authority, view)
    for (let i = 0; i < unlisted; i += 1) input.onEvent?.("sync.keyring.member_unlisted")
    const request = await rotationAppend(keyring, head, chain.account, authority, material, members, [
      ...authority.registry.values(),
    ])
    await fault("before-append")
    const result = await http.appendKeys(request)
    if (result.ok) {
      await chain.reach(result.seq)
      const after = chain.state()
      const verified =
        after.authority?.epoch === authority.epoch + 1 &&
        sameMembers(after, new Set(members.map((m) => m.id))) &&
        (await chain.epochKey(authority.epoch + 1)) !== null
      if (!verified || after.head === null) {
        input.onEvent?.("sync.keyring.unverified")
        return frozen("unverified")
      }
      rotated.set(scope, { keyringLink: after.head.keyring_link, revoked: view.revoked })
      refused.delete(scope)
      input.onEvent?.("sync.keyring.rotated")
      return { kind: "rotated" }
    }
    if (result.reason === "stale_base") return "stale"
    if (result.reason === "rate_limited") return frozen("rate_limited")
    if (result.reason === "not_found") return frozen("unavailable")
    return "reread"
  }

  const settleOnce = async (): Promise<FreezeOutcome> => {
    let lostRace = false
    let reread = false
    for (let round = 0; round < ATTEMPTS; round += 1) {
      if (round > 0 && !lostRace) await sleep(staleBackoffMs(round - 1))
      const served = await http.state()
      await fault("after-state-read")
      if (served === null) return frozen("unavailable")
      if (!served.rotationPending) {
        if (lostRace) input.onEvent?.("sync.keyring.rotation_adopted")
        return lostRace ? { kind: "adopted" } : { kind: "clear" }
      }
      await chain.reach(served.head.seq)
      const state = chain.state()
      if (!atServedHead(state, served.head) || state.authority === null) {
        input.onEvent?.("sync.keyring.unverified")
        return frozen("unverified")
      }
      const gate = chainGate(state, self)
      if (gate.kind !== "ok") return gate
      const wrap = committedWrap(state, state.authority.epoch, `device:${self.id}`)
      const material =
        wrap === null
          ? null
          : await ownMaterial(keyring, chain.account, wrap, expectedHistory(state.authority, state.authority.epoch))
      if (material === null) return frozen("no_epoch_key")
      try {
        const view = await input.revocationView()
        await fault("after-devices-read")
        const usable = viewGate(view, self.id)
        if (usable.kind !== "ok" || view.kind !== "usable")
          return usable.kind === "ok" ? frozen("device_list_unusable") : usable
        const outcome = await attempt(served.head, material, view, state)
        if (outcome === "stale") {
          lostRace = true
          continue
        }
        if (outcome !== "reread") return outcome
        if (!reread) {
          reread = true
          if (revokedGrew(view.revoked, await input.revocationView())) continue
        }
        refused.set(scope, { keyringLink: served.head.keyring_link, revoked: view.revoked })
        input.onEvent?.("sync.keyring.rotation_refused")
        return frozen("refused")
      } finally {
        zero(material)
      }
    }
    return frozen("rotating")
  }

  return {
    async settle() {
      const running = inFlight.get(scope)
      if (running !== undefined) return running
      const settling = settleOnce().catch((): FreezeOutcome => frozen("unavailable"))
      inFlight.set(scope, settling)
      try {
        return await settling
      } finally {
        inFlight.delete(scope)
      }
    },
  }
}
