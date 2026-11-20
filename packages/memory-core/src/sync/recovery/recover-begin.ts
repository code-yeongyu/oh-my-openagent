import type { RecoverBeginResult, RecoverySessionBridge, RecoveryTransport } from "./ports.ts"
import { servedPhraseHints } from "./phrase-hints.ts"
import { servedSaltInputs } from "./salt-inputs.ts"

type BeginInput = {
  readonly account: string
  readonly rpId: string
  readonly transport: RecoveryTransport
  readonly acknowledgeUnknownCredential?: boolean
}

export type BeginRefusal = "no-recovery-key" | "unavailable" | "too-many-recovery-keys"

export const beginWithPasskey = async (
  input: BeginInput,
  bridge: RecoverySessionBridge,
): Promise<RecoverBeginResult | BeginRefusal> => {
  const served = await servedSaltInputs(input.transport)
  if (!served.ok) return served.reason
  if (served.salts.length === 0) return "no-recovery-key"
  return bridge.recoverBegin({
    account: input.account,
    rpId: input.rpId,
    salts: served.salts,
    knownCredentialIds: served.salts.map((salt) => salt.credentialId),
    acknowledgeUnknown: input.acknowledgeUnknownCredential === true,
  })
}

/** The phrase is derived only against served phrase-kind hints; the anchored walk in `recover.ts` decides (contract 6, DI). */
export const beginWithPhrase = async (
  input: BeginInput,
  bridge: RecoverySessionBridge,
): Promise<RecoverBeginResult | BeginRefusal> => {
  const begin = bridge.recoverBeginWithPhrase
  if (begin === undefined) return "unavailable"
  const served = await servedPhraseHints(input.transport)
  if (!served.ok) return served.reason
  if (served.hints.length === 0) return "no-recovery-key"
  return begin({ account: input.account, hints: served.hints })
}
