import { lineBytes } from "./limits.ts";
import { LocalApiError } from "./errors.ts";
import type { ListingBegin, ListingEnd, ListingRow, ListingRows } from "./protocol.ts";

export type ListingHead = {
  readonly query_id: string;
  readonly revision: number;
  readonly incomplete: readonly string[];
};

// One listing revision as lines: listing_begin, listing_rows pages whose whole line (LF included) is at most `max`
// bytes, then listing_end. A page grows by one row's JSON plus a comma, so its size is known before it is written.
export const pageListing = (
  rows: readonly ListingRow[],
  max: number,
  head: ListingHead,
): readonly (ListingBegin | ListingRows | ListingEnd)[] => {
  const { query_id, revision, incomplete } = head;
  const empty: ListingRows = {
    type: "event",
    kind: "sessions.listing_rows",
    query_id,
    revision,
    rows: [],
  };
  const base = lineBytes(empty);
  const pages: ListingRows[] = [];
  let page: ListingRow[] = [];
  let size = base;
  for (const row of rows) {
    const rowBytes = lineBytes(row) - 1;
    if (base + rowBytes > max)
      throw new LocalApiError("protocol_violation", "a listing row cannot fit one page");
    const grown = size + rowBytes + (page.length > 0 ? 1 : 0);
    if (grown > max) {
      pages.push({ ...empty, rows: page });
      page = [row];
      size = base + rowBytes;
      continue;
    }
    page.push(row);
    size = grown;
  }
  if (page.length > 0) pages.push({ ...empty, rows: page });
  return [
    { type: "event", kind: "sessions.listing_begin", query_id, revision },
    ...pages,
    { type: "event", kind: "sessions.listing_end", query_id, revision, incomplete },
  ];
};
