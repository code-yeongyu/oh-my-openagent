import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { b64urlDecode, b64urlEncode } from "../../crypto/vendor/sync-format/jcs.ts"
import { publicKeyText, type RecoveryKeyPairs } from "../derive.ts"
import { derivePhraseKeys, parseRecoveryPhrase, TypedPhrase } from "../phrase.ts"

export const PHRASE_RP_ID = "omo-sync/v1/recovery-phrase"

type FixtureVector = { readonly name: string; readonly words: string; readonly enrollment_nonce: string }

const fixtureVector = (): FixtureVector => {
  const fixture: { readonly vectors: ReadonlyArray<FixtureVector> } = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../fixtures/phrase-v1.json"), "utf8"),
  )
  const found = fixture.vectors.find((vector) => vector.name === "account-a")
  if (found === undefined) throw new Error("phrase fixture vector account-a is missing")
  return found
}

export type PhraseRecoveryFixture = {
  readonly keys: RecoveryKeyPairs
  readonly key: {
    readonly credential_id: string
    readonly rp_id: typeof PHRASE_RP_ID
    readonly enrollment_nonce: string
    readonly sealing_public_key: string
    readonly signing_public_key: string
    readonly survivable: "phrase"
  }
}

/** A phrase recovery key derived from the fixed test vector "account-a" for `account` (never a real phrase). */
export const phraseRecoveryFor = async (account: string, credentialSeed = 9): Promise<PhraseRecoveryFixture> => {
  const vector = fixtureVector()
  const parsed = parseRecoveryPhrase(new TypedPhrase(vector.words))
  if (!parsed.ok) throw new Error("phrase fixture words refused")
  const keys = await derivePhraseKeys(parsed.phrase, account, b64urlDecode(vector.enrollment_nonce))
  parsed.phrase.dispose()
  return {
    keys,
    key: {
      credential_id: b64urlEncode(new Uint8Array(16).fill(credentialSeed)),
      rp_id: PHRASE_RP_ID,
      enrollment_nonce: vector.enrollment_nonce,
      ...publicKeyText(keys),
      survivable: "phrase",
    },
  }
}

/** Credential ids of the wrong length for a phrase key (contract sec 1 rule 3). */
export const wrongLengthCredentialIds: ReadonlyArray<readonly [number, string]> = [15, 17, 32].map(
  (length) => [length, b64urlEncode(new Uint8Array(length).fill(7))] as const,
)

/** Kind/rp pairs every parser must refuse (contract sec 1 rules 1, 2 and 4), as record field overrides. */
export const refusedKindPairs: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ["phrase kind with a passkey rp_id", { survivable: "phrase", rp_id: "recovery.omo.dev" }],
  ["synced kind with the phrase marker", { survivable: "synced", rp_id: PHRASE_RP_ID }],
  ["roaming kind with the phrase marker", { survivable: "roaming", rp_id: PHRASE_RP_ID }],
  ["synced kind in the reserved omo-sync/ namespace", { survivable: "synced", rp_id: "omo-sync/v2/other" }],
  ["roaming kind equal to the reserved prefix", { survivable: "roaming", rp_id: "omo-sync/" }],
  ["an unknown kind", { survivable: "paper", rp_id: PHRASE_RP_ID }],
]
