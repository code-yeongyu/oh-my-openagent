import { PHRASE_RECOVERY_RP_ID } from "../crypto/parse.ts"
import { rootChangedSinceRetired } from "../crypto/trust-pin.ts"
import { admitSyncOperation, checkSyncOperation, syncOperationSignal } from "../operation-authority.ts"
import { type GenesisBridge, GenesisEnableError } from "../genesis/bridge.ts"
import { buildGenesis } from "../genesis/build.ts"
import { completeGenesis } from "../genesis/complete.ts"
import { storeGenesisIntent } from "../genesis/intent-store.ts"
import type { GenesisIntent } from "../genesis/intent-verify.ts"
import { verifyGenesisRequest } from "../genesis/intent-verify.ts"
import {
  deletePhraseGenesisMarker,
  type PhraseGenesisPlace,
  writePhraseGenesisMarker,
} from "../genesis/phrase-marker.ts"
import type { EnableOutcome, EnableSyncInput } from "./enable.ts"
import { principalOf } from "./join.ts"
import type { PairingHttp } from "./pairing-http.ts"
import type { AccountHttp } from "./http.ts"

type Captured = EnableSyncInput & { readonly chain: AccountHttp; readonly pairing: PairingHttp }

export const isPhraseIntent = (intent: GenesisIntent): boolean =>
  intent.request.record.bootstrap.recovery_key.survivable === "phrase"

export const placeOf = (input: EnableSyncInput): PhraseGenesisPlace => ({
  pinDir: input.pinDir,
  account: input.account,
  principalId: input.keyring.principal().id,
})

/** Commits a stored intent; for a phrase intent, only `created` clears the marker (review L7). */
export const commitIntent = async (captured: Captured, intent: GenesisIntent): Promise<EnableOutcome> => {
  const result = await completeGenesis(captured, intent)
  checkSyncOperation(captured)
  if (result === "phrase_refused") return { kind: "phrase_unavailable", reason: "service-floor-off" }
  if (result !== "created")
    return isPhraseIntent(intent) ? { kind: "join_required", phraseVoid: { purpose: "genesis" } } : { kind: "join_required" }
  if (isPhraseIntent(intent)) await deletePhraseGenesisMarker(placeOf(captured))
  return (await rootChangedSinceRetired(captured.pinDir, captured.account, intent.genesisDigest))
    ? { kind: "joined", created: true, rootChanged: true }
    : { kind: "joined", created: true }
}

/**
 * Recovery-phrase genesis in the order of contract 5.1 (review F7, M1-M2): the marker is written before
 * any word is shown; the person confirms on the surface; only then the marker records the digest, the
 * intent is stored, both switches are set and the genesis appended. A refusal before the bridge returns
 * deletes the marker and writes nothing else. Once the bridge returned, the marker stays until the phrase
 * genesis is created, so a crash or a lost race reads as a void phrase, never as a saved one.
 */
export const createPhraseGenesis = async (
  captured: Captured,
  genesis: GenesisBridge & { readonly createPhraseGenesis: NonNullable<GenesisBridge["createPhraseGenesis"]> },
  serviceOrigin: string,
): Promise<EnableOutcome> => {
  const place = placeOf(captured)
  const startedAt = Date.now()
  await writePhraseGenesisMarker(place, { version: 1, account: captured.account, startedAt })
  captured.onCeremony?.("phrase")
  const operation = {
    signal: syncOperationSignal(captured) ?? new AbortController().signal,
    admit: <T>(begin: () => T): T => admitSyncOperation(captured, begin),
  }
  let result: Awaited<ReturnType<typeof genesis.createPhraseGenesis>>
  try {
    result = await admitSyncOperation(captured, () =>
      genesis.createPhraseGenesis({ account: captured.account, firstDevice: principalOf(captured.keyring) }, { operation }),
    )
  } catch (error) {
    await deletePhraseGenesisMarker(place)
    throw error
  }
  if (!result.ok) {
    await deletePhraseGenesisMarker(place)
    return { kind: "cancelled" }
  }
  const key = result.prepared.body.bootstrap.recovery_key
  if (key.survivable !== "phrase" || key.rp_id !== PHRASE_RECOVERY_RP_ID) throw new GenesisEnableError("intent_mismatch")
  const built = await buildGenesis(captured.account, captured.keyring, result.prepared, captured)
  await verifyGenesisRequest(captured.account, captured.keyring, built.request)
  await writePhraseGenesisMarker(place, { version: 1, account: captured.account, startedAt, genesisDigest: built.digest })
  const intent: GenesisIntent = {
    version: 1,
    account: captured.account,
    serviceOrigin,
    serviceDeviceId: captured.serviceDeviceId,
    syncPrincipal: principalOf(captured.keyring),
    genesisDigest: built.digest,
    request: built.request,
  }
  await storeGenesisIntent(captured, intent)
  await captured.pairing.setAccountSync(true)
  await captured.pairing.setDeviceSync(captured.serviceDeviceId, true)
  checkSyncOperation(captured)
  return commitIntent(captured, intent)
}
