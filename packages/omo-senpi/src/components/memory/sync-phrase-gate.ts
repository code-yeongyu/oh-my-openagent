import type { PhraseGate } from "@oh-my-opencode/memory-core/sync-engine"

/** The engine flag that releases recovery-phrase key creation (contract amendment A1); off unless exactly "1". */
export const PHRASE_GENESIS_FLAG = "OMO_MEMORY_SYNC_PHRASE_GENESIS"

/**
 * The host's phrase gate. memory-core re-reads the service floor (`phrase_client_floor`) on every
 * creation through the operation's own state route; an absent or unreadable floor refuses (A1.3).
 */
export function phraseGateFrom(
  env: Readonly<Record<string, string | undefined>>,
  logger: { error(message: string, fields?: Record<string, unknown>): void },
): PhraseGate {
  return {
    enabled: env[PHRASE_GENESIS_FLAG] === "1",
    refused: (reason, account) =>
      logger.error("memory sync refused to create a recovery phrase", { reason, account, flag: PHRASE_GENESIS_FLAG }),
  }
}
