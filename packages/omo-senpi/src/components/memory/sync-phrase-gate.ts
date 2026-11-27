import type { AccountHttp, PhraseGate, ServiceFloor } from "@oh-my-opencode/memory-core/sync-engine"

/**
 * memory-core's `readServiceFloor`, loaded with the sync runtime rather than the eager bundle. memory-core calls
 * it fresh for every creation with the operation's own signed-in chain, so the floor is the service's
 * `GET /v1/sync/state` `accepts_phrase_keys` read through the real client and session; no env var reaches it.
 * A load or read failure rejects, which memory-core treats as an unknown floor and refuses (A1.1-M4.1).
 */
const readServiceFloor = async (chain: AccountHttp): Promise<ServiceFloor> =>
  (await import("#omo-memory-sync-runtime")).readServiceFloor(chain)

/** The host's phrase gate: creation follows the service floor alone; there is no client flag (#14432). */
export function phraseGateFrom(logger: { error(message: string, fields?: Record<string, unknown>): void }): PhraseGate {
  return {
    enabled: true,
    serviceFloor: readServiceFloor,
    refused: (reason, account) => logger.error("memory sync refused to create a recovery phrase", { reason, account }),
  }
}
