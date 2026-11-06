import { openAccountChain, type AccountChain } from "../account/account-chain.ts"
import type { AccountHttp } from "../account/http.ts"
import { creatorAnchor, type ChainAnchor } from "../crypto/anchor.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import { checkSyncOperation, type SyncOperationOptions } from "../operation-authority.ts"
import { GenesisEnableError } from "./bridge.ts"
import { retireGenesisIntent } from "./intent-store.ts"
import { type GenesisIntent, verifyCompetingGenesis } from "./intent-verify.ts"

export const completeAccountChain = async (input: {
  readonly account: string; readonly keyring: DeviceKeyring; readonly chain: AccountHttp
}, anchor: ChainAnchor): Promise<AccountChain> => {
  const walked = await openAccountChain({ account: input.account, keyring: input.keyring, http: input.chain, anchor, rejections: createRejectionCounter() })
  const served = await input.chain.state()
  if (served === null) throw new GenesisEnableError("malformed_reply")
  await walked.reach(served.head.seq)
  const head = walked.state().head
  if (!walked.state().anchored || head === null || head.seq !== served.head.seq || head.link !== served.head.link ||
      head.keyring_link !== served.head.keyring_link) throw new GenesisEnableError("incomplete_chain")
  if (walked.isMember() && await walked.epochKey(walked.state().authority?.epoch ?? 0) === null) throw new GenesisEnableError("unusable_key")
  return walked
}

/** Resume only this exact transaction. Never mint again or re-sign at a nonzero base. */
export const completeGenesis = async (input: {
  readonly account: string; readonly serviceOrigin?: string; readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring; readonly pinDir: string; readonly chain: AccountHttp
} & SyncOperationOptions, intent: GenesisIntent): Promise<"created" | "join_required"> => {
  const before = await input.chain.listKeys()
  if (before === null) throw new GenesisEnableError("malformed_reply")
  if (before[0]?.digest !== intent.genesisDigest) {
    const appended = await input.chain.appendKeys(intent.request)
    checkSyncOperation(input)
    if (!appended.ok) {
      if (appended.reason !== "stale_base") throw new GenesisEnableError("append_refused")
      const current = await input.chain.listKeys()
      if (current === null || current.length === 0) throw new GenesisEnableError("incomplete_chain")
      const first = current[0]
      if (first?.digest !== intent.genesisDigest) {
        // A genuinely different creator won CAS. A conflicting record naming us is equivocation.
        if (first?.kind !== "keyring" || first.seq !== 1 || first.body.kind !== "genesis" ||
            first.author.kind !== "device" || first.author.id === input.keyring.principal().id) {
          throw new GenesisEnableError("intent_mismatch")
        }
        await verifyCompetingGenesis(first, input.account)
        await retireGenesisIntent(input)
        return "join_required"
      }
    } else if (appended.seq !== 1) {
      throw new GenesisEnableError("malformed_reply")
    }
  }
  const walked = await completeAccountChain(input, creatorAnchor(input.account, input.keyring))
  const state = walked.state()
  if (state.genesisDigest !== intent.genesisDigest || state.pin === null || !walked.isMember()) {
    throw new GenesisEnableError("intent_mismatch")
  }
  await pinTrustAnchor(input.pinDir, input.account, state.pin, input)
  await retireGenesisIntent(input)
  checkSyncOperation(input)
  return "created"
}
