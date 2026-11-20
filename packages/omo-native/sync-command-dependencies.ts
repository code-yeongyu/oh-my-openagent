import type { CeremonyClock } from "../memory-core/src/sync/account/index.ts"
import type { PhraseGate } from "../memory-core/src/sync/genesis/phrase-gate.ts"
import type { SyncContext } from "./sync-context"
import type { PhraseTerminal } from "./sync-phrase-tty"

export const EXIT_UNSUPPORTED_HERE = 2

export interface SyncCommandDependencies {
  readonly context: () => Promise<SyncContext>
  readonly clock: CeremonyClock
  readonly output: (line: string) => void
  readonly error: (line: string) => void
  readonly confirm: (question: string) => Promise<boolean>
  readonly interactive: boolean
  /** The environment the refusal markers and the phrase flag are read from. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Opens the controlling terminal; null when there is none. Words never go anywhere else. */
  readonly terminal?: () => PhraseTerminal | null
  readonly terminalAvailable?: () => boolean
  /**
   * The service floor reader; tests inject one. Absent, the gate reads the service's own `accepts_phrase_keys`
   * fresh for every creation through the operation's signed-in chain, and any failure refuses (#13631).
   */
  readonly phraseFloor?: PhraseGate["serviceFloor"]
}
