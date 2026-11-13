import type { DeviceKeyring } from "../keyring-port.ts"
import { enrollInBridge } from "./bridge-enroll.ts"
import { recoverBeginInBridge, recoverFinishInBridge } from "./bridge-recover.ts"
import { enrollPhraseInBridge } from "./bridge-enroll-phrase.ts"
import { type PhraseEntrySurface, recoverBeginWithPhraseInBridge } from "./bridge-recover-phrase.ts"
import type { PhraseBridgeRandom, PhraseSurface } from "../genesis/phrase-bridge.ts"
import { disposeRecoveryKeys, type RecoveryKeyPairs } from "./derive.ts"
import type { PasskeyAuthenticator, RecoveryBridge } from "./ports.ts"
import { createRecoveryHandles, type RecoveryHandles, type Schedule } from "./recovery-handles.ts"

export type ReferenceBridgeOptions = {
  readonly now?: () => number
  /** The TTL timer; tests pass one they fire by hand. */
  readonly schedule?: Schedule
  /** Sees each derived key pair when it is held, so tests can prove it is zeroed on every exit. */
  readonly onKeysDerived?: (keys: RecoveryKeyPairs) => void
  /** Where this bridge shows a new phrase and reads a typed one; without it the bridge has no phrase members. */
  readonly phraseSurface?: PhraseSurface & PhraseEntrySurface
  readonly phraseRandom?: PhraseBridgeRandom
  /** Aborts a running phrase ceremony (show and confirm). */
  readonly signal?: AbortSignal
}

// Review LOW (#13336): the host's signal reaches show-and-confirm, so an enrollment can be cancelled through it.
const operationOf = (signal: AbortSignal | undefined) => ({
  signal: signal ?? new AbortController().signal,
  admit: <T>(begin: () => T): T => {
    signal?.throwIfAborted()
    return begin()
  },
})

const phraseMembers = (
  surface: PhraseSurface & PhraseEntrySurface,
  keyring: DeviceKeyring,
  handles: RecoveryHandles,
  random: PhraseBridgeRandom | undefined,
  signal: AbortSignal | undefined,
): Pick<RecoveryBridge, "recoverBeginWithPhrase" | "enrollPhrase"> => ({
  recoverBeginWithPhrase: (request) => recoverBeginWithPhraseInBridge(surface, handles, request),
  enrollPhrase: (request) => enrollPhraseInBridge(surface, keyring, request, operationOf(signal), random),
})

/**
 * The reference bridge: the protocol half that runs inside the native bridge process, over that
 * process's platform authenticator and its own device keyring. The desktop main process bridge
 * implements the same requests and results; this one runs it in-process for tests and fixtures.
 */
export const createRecoveryBridge = (
  authenticator: PasskeyAuthenticator,
  keyring: DeviceKeyring,
  options: ReferenceBridgeOptions = {},
): RecoveryBridge => {
  const store = createRecoveryHandles(options.now, undefined, options.schedule)
  const surface = options.phraseSurface
  const handles = {
    ...store,
    hold: (recovery: Parameters<typeof store.hold>[0]) => {
      options.onKeysDerived?.(recovery.keys)
      return store.hold(recovery)
    },
  }
  return {
    prfSupported: authenticator.prfSupported,
    enroll: (request) => enrollInBridge(authenticator, keyring, request),
    recoverBegin: (request) => recoverBeginInBridge(authenticator, handles, request),
    recoverFinish: (request) => recoverFinishInBridge(handles, request),
    recoverAbort: async (handle) => {
      const held = handles.take(handle)
      if (held !== null) disposeRecoveryKeys(held.keys)
    },
    signalRemoved: (rpId, credentialId) => authenticator.signalRemoved(rpId, credentialId),
    ...(surface === undefined ? {} : phraseMembers(surface, keyring, handles, options.phraseRandom, options.signal)),
  }
}
