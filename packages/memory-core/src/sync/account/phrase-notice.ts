import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import type { ChainState } from "../crypto/chain.ts"
import type { TrustAnchor } from "../crypto/anchor.ts"
import type { AccountHttp } from "./http.ts"
import { acknowledgeEnrollVoid, enrollNoticeStatus } from "../recovery/enroll-phrase.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import type { SyncOperationOptions } from "../operation-authority.ts"
import { loadGenesisIntent, withGenesisLock } from "../genesis/intent-store.ts"
import {
  deletePhraseGenesisMarker,
  genesisIntentPresent,
  genesisLockHeldByLiveOwner,
  genesisPhraseState,
  type PhraseGenesisPlace,
} from "../genesis/phrase-marker.ts"

/** A recovery phrase this device showed that was not saved (A3 engine contract 5.1/6). Holds no secret. */
export type PhraseVoidNotice =
  | { readonly purpose: "genesis" }
  | { readonly purpose: "enroll" }
  | { readonly purpose: "rotate"; readonly oldStillValid: true }

export type PhraseNoticeStatus = {
  readonly phraseVoid?: PhraseVoidNotice
  readonly phraseUnresolved?: true
  readonly inProgress?: true
}

const pinnedDigest = async (pinDir: string, account: string): Promise<string | null> => {
  const pin = await loadTrustAnchor(pinDir, account)
  return pin.ok ? pin.anchor.genesisDigest : null
}

/**
 * The read-only phrase notice for a status answer (review M1, C3). It never deletes anything, so an
 * unseen poll cannot consume it. While a live process holds the genesis lock a ceremony is running, so
 * this reports in-progress and never a void that may still be saved.
 */
export const phraseNoticeStatus = async (
  place: PhraseGenesisPlace,
  verifiedChain?: ChainState | null,
): Promise<PhraseNoticeStatus> => {
  if (await genesisLockHeldByLiveOwner(place)) return { inProgress: true }
  const state = await genesisPhraseState(place, {
    intentPresent: await genesisIntentPresent(place),
    pinnedGenesisDigest: await pinnedDigest(place.pinDir, place.account),
  })
  if (state.kind === "void") return { phraseVoid: { purpose: "genesis" } }
  if (state.kind === "unresolved") return { phraseUnresolved: true }
  // Enroll and rotate markers (review HIGH, #13336): resolved only against a verified chain the caller passes.
  return enrollNoticeStatus(place, verifiedChain)
}

export type AcknowledgeInput = {
  readonly account: string
  readonly serviceOrigin?: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly purpose: PhraseVoidNotice["purpose"]
  readonly credentialId?: string
  /** The signed-in account routes; an enroll or rotate notice is acknowledged only against the verified chain. */
  readonly chain?: AccountHttp
  /** The account's trust anchor; defaults to this device's pin. */
  readonly anchor?: TrustAnchor
} & SyncOperationOptions

/**
 * Clears a delivered void notice (review M4). The engine cannot tell who calls it, so callers gate it:
 * the desktop server accepts it only from the local shell, and the CLI only after showing the notice on
 * its own terminal. It deletes the marker only while the phrase is still void under the genesis lock;
 * any other state is left alone and the call is a no-op.
 */
export const acknowledgePhraseVoid = async (input: AcknowledgeInput): Promise<{ readonly ok: true }> =>
  withGenesisLock(input, async () => {
    const place = { pinDir: input.pinDir, account: input.account, principalId: input.keyring.principal().id }
    if (input.purpose !== "genesis") {
      if (input.chain !== undefined) await acknowledgeEnrollVoid(place, input.purpose, input.credentialId, input.chain, input.anchor)
      return { ok: true }
    }
    const state = await genesisPhraseState(place, {
      intentPresent: (await loadGenesisIntent(input)) !== null,
      pinnedGenesisDigest: await pinnedDigest(input.pinDir, input.account),
    })
    if (state.kind === "void") await deletePhraseGenesisMarker(place)
    return { ok: true }
  })
