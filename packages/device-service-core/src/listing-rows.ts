import type { LocalApiClient } from "./local-api/client.ts"
import type { ListingResult, ListingRevision } from "./local-api/client-assembly.ts"
import { LocalApiError } from "./local-api/errors.ts"
import type { SessionFilter } from "./local-api/protocol.ts"

type RowsVersion = 3 | 2 | undefined

// #13045: a listing row carries its session's durable_id only at rows 3 (#12996), so a cross-device address by durable
// id resolves only when the listing asks for it. A service that predates a rows version refuses it as invalid_request;
// the listing then steps down one version and remembers the version this service accepted for the next listing.
export function newestRowsListing(client: LocalApiClient) {
  let rows: RowsVersion = 3
  return async function list(filter?: SessionFilter, onRevision?: (revision: ListingRevision) => void): Promise<ListingResult> {
    for (;;) {
      try {
        return await client.list(filter, onRevision, rows)
      } catch (error) {
        if (rows === undefined || !(error instanceof LocalApiError) || error.code !== "invalid_request") throw error
        rows = rows === 3 ? 2 : undefined
      }
    }
  }
}
