import type { LocalApiClient } from "./local-api/client.ts"
import type { ListingResult, ListingRevision } from "./local-api/client-assembly.ts"
import { LocalApiError } from "./local-api/errors.ts"
import type { SessionFilter } from "./local-api/protocol.ts"

type RowsVersion = 7 | 6 | 5 | 4 | 3 | 2 | undefined

// #13045: a listing row carries its session's durable_id only at rows 3 (#12996), so a cross-device address by durable
// id resolves only when the listing asks for it; rows 4 adds each row's model and archived flag (omo-relay-spec#295),
// rows 5 its settled state, rows 6 its holder's retry wait and rows 7 its holder's engine version (relay-daemon#1480).
// A service that predates a rows version refuses it as invalid_request; the listing then steps down one version and
// remembers the version this service accepted for the next listing.
const OLDER: Record<NonNullable<RowsVersion>, RowsVersion> = { 7: 6, 6: 5, 5: 4, 4: 3, 3: 2, 2: undefined }

export function newestRowsListing(client: LocalApiClient) {
  let rows: RowsVersion = 7
  return async function list(
    filter?: SessionFilter,
    onRevision?: (revision: ListingRevision) => void,
  ): Promise<ListingResult> {
    for (;;) {
      try {
        return await client.list(filter, onRevision, rows)
      } catch (error) {
        if (rows === undefined || !(error instanceof LocalApiError) || error.code !== "invalid_request") throw error
        rows = OLDER[rows]
      }
    }
  }
}
