import type { AccountState } from "../../account/http.ts"
import type { RecoveryTransport } from "../ports.ts"

/**
 * The account reads `enableSync` adds to a recovery transport, derived from the same served list:
 * entries after a seq, and the served head. Lets a test run `enable` right after a recovery on the
 * recovery fake server (D12 test 13).
 */
export const accountReads = (transport: RecoveryTransport) => ({
  listEntriesAfter: async (after: number) => {
    const rows = await transport.listEntries()
    return rows === null ? null : rows.filter((row) => row.seq > after)
  },
  state: async (): Promise<AccountState | null> => {
    const rows = await transport.listEntries()
    const head = rows?.at(-1)
    if (rows === null || head === undefined) return null
    return {
      // A batch row carries no keyring link; the head's is the last keyring record's.
      head: {
        seq: head.seq,
        link: head.link,
        keyring_link: rows.findLast((row) => row.keyring_link !== null)?.keyring_link ?? "",
      },
      currentEpoch: Math.max(...rows.map((row) => row.epoch)),
      rotationPending: false,
      acceptsPhraseKeys: true,
    }
  },
})
