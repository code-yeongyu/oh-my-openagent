import { b64urlDecode } from "../crypto/vendor/sync-format/jcs.ts"
import { disposeRecoveryKeys, publicKeyText, type RecoveryKeyPairs } from "./derive.ts"
import { derivePhraseKeys, parseRecoveryPhrase, type PhraseParseFailure, type TypedPhrase } from "./phrase.ts"
import type { PhraseRecoveryHint } from "./phrase-hints.ts"
import type { RecoverBeginResult } from "./ports.ts"
import type { RecoveryHandles } from "./recovery-handles.ts"

/** Where a person types an existing recovery phrase; a bad entry is reported back and asked again. */
export interface PhraseEntrySurface {
  /** Null means cancelled. `retry` names why the previous entry was refused (a position, never a word). */
  enter(retry: PhraseParseFailure | null): Promise<TypedPhrase | null>
}

export type PhraseRecoverBeginRequest = {
  readonly account: string
  readonly hints: ReadonlyArray<PhraseRecoveryHint>
}

/**
 * Phrase recovery begin (contract 6): the typed phrase is parsed (checksum before any derivation), then derived
 * against each served phrase hint; only the hint whose derived PUBLIC keys match is held, behind the same
 * one-shot handle as a passkey. Finish, the anchored walk and `provenRecoveryMaterial` then run unchanged. A
 * valid phrase that matches no hint is `history-incomplete` (F14). Every other derived key is overwritten.
 */
export const recoverBeginWithPhraseInBridge = async (
  surface: PhraseEntrySurface,
  handles: RecoveryHandles,
  request: PhraseRecoverBeginRequest,
): Promise<RecoverBeginResult> => {
  handles.disposeAll()
  if (request.hints.length === 0) return { ok: false, reason: "not-enrolled" }
  let retry: PhraseParseFailure | null = null
  for (;;) {
    const typed = await surface.enter(retry)
    if (typed === null) return { ok: false, reason: "cancelled" }
    const parsed = parseRecoveryPhrase(typed)
    if (!parsed.ok) {
      retry = parsed
      continue
    }
    const phrase = parsed.phrase
    try {
      for (const hint of request.hints) {
        const keys: RecoveryKeyPairs = await derivePhraseKeys(
          phrase,
          request.account,
          b64urlDecode(hint.enrollmentNonce),
        )
        const publicKeys = publicKeyText(keys)
        if (
          publicKeys.sealing_public_key !== hint.sealing_public_key ||
          publicKeys.signing_public_key !== hint.signing_public_key
        ) {
          disposeRecoveryKeys(keys)
          continue
        }
        const handle = handles.hold({ account: request.account, credentialId: hint.credentialId, ...publicKeys, keys })
        return { ok: true, handle, credentialId: hint.credentialId, ...publicKeys }
      }
      return { ok: false, reason: "history-incomplete" }
    } finally {
      phrase.dispose()
    }
  }
}
