import { PHRASE_RECOVERY_RP_ID } from "../crypto/parse.ts"
import { b64urlEncode } from "../crypto/vendor/sync-format/jcs.ts"
import { signFramed } from "../crypto/vendor/sync-format/keys.ts"
import type { SyncOperationAuthority } from "../operation-authority.ts"
import { disposeRecoveryKeys, publicKeyText } from "../recovery/derive.ts"
import { sealWrap } from "../recovery/key-material.ts"
import {
  confirmationMatches,
  confirmationPositions,
  derivePhraseKeys,
  generateRecoveryPhrase,
  type RecoveryPhrase,
  type TypedPhrase,
} from "../recovery/phrase.ts"
import type { GenesisBridgeResult, PhraseGenesisBridgeRequest } from "./bridge.ts"
import { prepareGenesis } from "./prepare.ts"

/**
 * The only place a person sees or types recovery words: the desktop's protected window, or the CLI's
 * own terminal. It resolves the account label it shows from its own signed-in session.
 */
export interface PhraseSurface {
  /** Shows the words, hidden until the person asks to see them; false means cancelled. */
  show(phrase: RecoveryPhrase): Promise<boolean>
  /** Asks for the words at these 1-based positions, in order; null means cancelled. */
  confirm(positions: ReadonlyArray<number>): Promise<TypedPhrase | null>
}

export type PhraseBridgeRandom = {
  readonly phrase?: () => RecoveryPhrase
  readonly bytes?: (length: number) => Uint8Array<ArrayBuffer>
  readonly positions?: () => ReadonlyArray<number>
}

const randomBytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(length))

/** Shows the phrase and repeats the 3-word check until it matches; false when the person cancels. */
export const showAndConfirm = async (
  surface: PhraseSurface,
  phrase: RecoveryPhrase,
  operation: SyncOperationAuthority,
  positions: () => ReadonlyArray<number>,
): Promise<boolean> => {
  if (!(await operation.admit(() => surface.show(phrase)))) return false
  for (;;) {
    const asked = positions()
    const answer = await operation.admit(() => surface.confirm(asked))
    if (answer === null) return false
    if (confirmationMatches(phrase, asked, answer)) return true
  }
}

/**
 * Reference recovery-phrase genesis (A3 engine contract 5.1): E, K1 and the derived keys live only here.
 * The words are shown and confirmed before anything is derived; only `prepareGenesis` output, which is
 * public, leaves. Every secret is overwritten on every exit.
 */
export const createPhraseGenesisBridge =
  (surface: PhraseSurface, random: PhraseBridgeRandom = {}) =>
  async (
    request: PhraseGenesisBridgeRequest,
    options: { readonly operation: SyncOperationAuthority },
  ): Promise<GenesisBridgeResult> => {
    const bytes = random.bytes ?? randomBytes
    const phrase = (random.phrase ?? generateRecoveryPhrase)()
    try {
      const confirmed = await showAndConfirm(surface, phrase, options.operation, random.positions ?? confirmationPositions)
      if (!confirmed) return { ok: false, reason: "cancelled" }
      const nonce = bytes(32)
      const keys = await derivePhraseKeys(phrase, request.account, nonce)
      const epochKey = bytes(32)
      try {
        const prepared = await prepareGenesis(
          {
            account: request.account,
            custody_nonce: b64urlEncode(bytes(16)),
            first_device: request.firstDevice,
            recovery_key: {
              credential_id: b64urlEncode(bytes(16)),
              rp_id: PHRASE_RECOVERY_RP_ID,
              enrollment_nonce: b64urlEncode(nonce),
              ...publicKeyText(keys),
              survivable: "phrase",
            },
          },
          {
            seal: async (address, recipient) =>
              (await sealWrap(address, recipient, { epoch: 1, current: epochKey, history: [] })).wrap,
            countersign: (payload) => signFramed(payload.t, payload, keys.signSeed),
          },
        )
        return { ok: true, prepared }
      } finally {
        epochKey.fill(0)
        disposeRecoveryKeys(keys)
      }
    } finally {
      phrase.dispose()
    }
  }
