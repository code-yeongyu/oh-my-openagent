import { loadTrustAnchor, TrustPinError } from "../crypto/trust-pin.ts"
import { creatorAnchor } from "../crypto/anchor.ts"
import { LockContentionError } from "../../locks/acquire.ts"
import type { DeviceKeyring } from "../keyring-port.ts"
import {
  checkSyncOperation,
  admitSyncOperation,
  syncOperationSignal,
  type SyncOperationOptions,
} from "../operation-authority.ts"
import { type GenesisBridge, GenesisEnableError } from "../genesis/bridge.ts"
import { buildGenesis } from "../genesis/build.ts"
import { completeAccountChain } from "../genesis/complete.ts"
import { loadGenesisIntent, storeGenesisIntent, withGenesisLock } from "../genesis/intent-store.ts"
import { verifyGenesisRequest } from "../genesis/intent-verify.ts"
import { deletePhraseGenesisMarker, genesisPhraseState } from "../genesis/phrase-marker.ts"
import type { AccountHttp } from "./http.ts"
import type { PairingHttp } from "./pairing-http.ts"
import { principalOf } from "./join.ts"
import { accountOperation, pairingOperation } from "./operation-ports.ts"
import { commitIntent, createPhraseGenesis, placeOf } from "./enable-phrase.ts"
import type { PhraseVoidNotice } from "./phrase-notice.ts"

export type EnableMethod = "passkey" | "phrase"

export type EnableOutcome =
  | { readonly kind: "joined"; readonly created?: true; readonly rootChanged?: true; readonly phraseVoid?: PhraseVoidNotice }
  | { readonly kind: "join_required"; readonly phraseVoid?: PhraseVoidNotice }
  | { readonly kind: "method_required"; readonly methods: ReadonlyArray<EnableMethod>; readonly phraseVoid?: PhraseVoidNotice }
  | { readonly kind: "acknowledge_required"; readonly phraseVoid: PhraseVoidNotice }
  | { readonly kind: "passkey_unavailable" }
  | { readonly kind: "phrase_unavailable" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "in_progress" }

export interface EnableSyncInput extends SyncOperationOptions {
  readonly account: string
  readonly serviceDeviceId: string
  readonly keyring: DeviceKeyring
  readonly pinDir: string
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  readonly serviceOrigin?: string
  readonly rpId?: string
  readonly userName?: string
  readonly roaming?: boolean
  readonly genesis?: GenesisBridge
  /** How a first device creates the account's recovery key; never defaulted when a genesis is needed (D1). */
  readonly method?: EnableMethod
  /** Called right before a bridge ceremony starts, so a status read can report it in progress. */
  readonly onCeremony?: (method: EnableMethod) => void
}

const methodsOf = (genesis: GenesisBridge | undefined): ReadonlyArray<EnableMethod> => [
  ...(genesis?.prfSupported === true ? (["passkey"] as const) : []),
  ...(genesis?.phraseSupported === true && genesis.createPhraseGenesis !== undefined ? (["phrase"] as const) : []),
]

/**
 * Turns sync on: joins or resumes an existing account chain, or creates its genesis with the method the
 * person chose (A3 engine contract 5.1). Another live process holding the ceremony answers in_progress.
 */
export async function enableSync(input: EnableSyncInput): Promise<EnableOutcome> {
  const chain = accountOperation(input.chain, input)
  const pairing = pairingOperation(input.pairing, input)
  const captured = { ...input, chain, pairing }
  try {
    return await withGenesisLock(captured, () => enableLocked(input, captured))
  } catch (error) {
    if (error instanceof LockContentionError) return { kind: "in_progress" }
    throw error
  }
}

async function enableLocked(
  input: EnableSyncInput,
  captured: EnableSyncInput & { readonly chain: AccountHttp; readonly pairing: PairingHttp },
): Promise<EnableOutcome> {
  const { chain, pairing } = captured
  checkSyncOperation(input)
  const pin = await loadTrustAnchor(input.pinDir, input.account)
  if (!pin.ok && pin.reason === "corrupt_pin") throw new TrustPinError("corrupt_pin")
  let intent = await loadGenesisIntent(captured)
  const keys = await chain.listKeys()
  if (keys === null) throw new GenesisEnableError("malformed_reply")
  if (pin.ok && keys.length === 0) throw new GenesisEnableError("incomplete_chain")
  if (pin.ok && intent !== null && pin.anchor.genesisDigest !== intent.genesisDigest)
    throw new TrustPinError("pin_conflict")
  const member = pin.ok ? (await completeAccountChain(captured, pin.anchor)).isMember() : false
  if (!pin.ok && intent !== null && keys.length > 0 && keys[0]?.digest === intent.genesisDigest) {
    const resumed = await completeAccountChain(captured, creatorAnchor(input.account, input.keyring))
    if (resumed.state().genesisDigest !== intent.genesisDigest || !resumed.isMember())
      throw new GenesisEnableError("intent_mismatch")
  }
  // Step 0 runs under the lock, so this enable's own record is excluded from the void reading (review M1).
  const phrase = await genesisPhraseState(placeOf(input), {
    intentPresent: intent !== null,
    pinnedGenesisDigest: pin.ok ? pin.anchor.genesisDigest : null,
    chainEmpty: keys.length === 0 && !pin.ok,
  })
  if (phrase.kind === "saved") await deletePhraseGenesisMarker(placeOf(input))
  const notice: { readonly phraseVoid?: PhraseVoidNotice } =
    phrase.kind === "void" ? { phraseVoid: { purpose: "genesis" } } : {}
  const creating = intent === null && !pin.ok && keys.length === 0
  const { genesis, serviceOrigin, rpId, userName } = input
  if (creating) {
    if (input.method === undefined) return { kind: "method_required", methods: methodsOf(genesis), ...notice }
    // An undelivered void notice stops every new ceremony until it is acknowledged (review M2).
    if (notice.phraseVoid !== undefined) return { kind: "acknowledge_required", phraseVoid: notice.phraseVoid }
    if (input.method === "phrase") {
      if (genesis?.phraseSupported !== true || genesis.createPhraseGenesis === undefined) return { kind: "phrase_unavailable" }
      if (!serviceOrigin) throw new GenesisEnableError("missing_configuration")
      return createPhraseGenesis(captured, { ...genesis, createPhraseGenesis: genesis.createPhraseGenesis }, serviceOrigin)
    }
    if (genesis?.prfSupported !== true) return { kind: "passkey_unavailable" }
    if (!serviceOrigin || !rpId || !userName) throw new GenesisEnableError("missing_configuration")
  }

  // Bootstrap readability is not consent. Joining, resuming and passkey creation turn both switches on here,
  // before any key or root is written; every refusal above returns with both switches untouched.
  await pairing.setAccountSync(true)
  await pairing.setDeviceSync(input.serviceDeviceId, true)
  checkSyncOperation(input)
  if (intent === null && (pin.ok || keys.length > 0)) return { kind: member ? "joined" : "join_required", ...notice }
  if (intent === null) {
    if (genesis === undefined || !serviceOrigin || !rpId || !userName) throw new GenesisEnableError("missing_configuration")
    const operation = {
      signal: syncOperationSignal(input) ?? new AbortController().signal,
      admit: <T>(begin: () => T): T => admitSyncOperation(input, begin),
    }
    input.onCeremony?.("passkey")
    const result = await admitSyncOperation(input, () =>
      genesis.createGenesis(
        { account: input.account, rpId, userName, roaming: input.roaming ?? false, firstDevice: principalOf(input.keyring) },
        { operation },
      ),
    )
    checkSyncOperation(input)
    if (!result.ok) throw new GenesisEnableError("bridge_refused", { cause: result.reason })
    if (result.prepared.body.bootstrap.recovery_key.rp_id !== rpId) throw new GenesisEnableError("intent_mismatch")
    const built = await buildGenesis(input.account, input.keyring, result.prepared, input)
    await verifyGenesisRequest(input.account, input.keyring, built.request)
    intent = {
      version: 1,
      account: input.account,
      serviceOrigin,
      serviceDeviceId: input.serviceDeviceId,
      syncPrincipal: principalOf(input.keyring),
      genesisDigest: built.digest,
      request: built.request,
    }
    await storeGenesisIntent(captured, intent)
  }
  return commitIntent(captured, intent)
}
