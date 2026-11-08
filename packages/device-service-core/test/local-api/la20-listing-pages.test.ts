import { afterEach, describe, expect, test } from "bun:test";
import { LOCAL_INLINE_MAX, lineBytes } from "../../src/local-api/chunking.ts";
import { LOCAL_LINE_MAX } from "../../src/local-api/framing.ts";
import { pageListing } from "../../src/local-api/listing.ts";
import type { ListingRow } from "../../src/local-api/protocol.ts";
import { validateEvent } from "../../src/local-api/validate.ts";
import { defaultWorld } from "./conformance/world.ts";
import { cleanup, connectClient, startOwner, verifierListing } from "./support.ts";

afterEach(cleanup);

const QUERY = "q".repeat(22);

describe("LA20 pageListing pages the verifier's 1,000-row listing", () => {
  test("control: the 1,000 rows as one sessions.listing_rows line are 1,535,973 bytes, over LOCAL_LINE_MAX", () => {
    const rows = verifierListing();
    const single = {
      type: "event",
      kind: "sessions.listing_rows",
      query_id: QUERY,
      revision: 1,
      rows,
    };
    expect(lineBytes(single)).toBe(1_535_973);
    expect(lineBytes(single)).toBeGreaterThan(LOCAL_LINE_MAX);
  });

  test("the paged form keeps every line under 524,288 bytes, loses and repeats no row, and ends with listing_end", () => {
    const rows = verifierListing();
    const events = pageListing(rows, LOCAL_INLINE_MAX, {
      query_id: QUERY,
      revision: 1,
      incomplete: [],
    });
    const sizes = events.map(lineBytes);
    console.log(
      `pages=${events.length - 2} max_line=${Math.max(...sizes)} limit=${LOCAL_INLINE_MAX}`,
    );
    expect(events[0]?.kind).toBe("sessions.listing_begin");
    expect(events.at(-1)?.kind).toBe("sessions.listing_end");
    expect(events.slice(1, -1).every((e) => e.kind === "sessions.listing_rows")).toBe(true);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(LOCAL_INLINE_MAX);
    const paged = events.flatMap((e) => (e.kind === "sessions.listing_rows" ? e.rows : []));
    expect(paged).toEqual([...rows]);
    for (const event of events) expect(validateEvent(event)).toEqual(event);
  });

  test("an empty revision is begin then end", () => {
    const events = pageListing([], LOCAL_INLINE_MAX, {
      query_id: QUERY,
      revision: 3,
      incomplete: ["dev-x"],
    });
    expect(events.map((e) => e.kind)).toEqual(["sessions.listing_begin", "sessions.listing_end"]);
  });

  test("a client assembles the paged revision into the same 1,000 rows", async () => {
    const rows: readonly ListingRow[] = verifierListing();
    const world = defaultWorld();
    const owner = await startOwner({
      ...world,
      listing: { revisions: [{ rows, incomplete: [] }], devices: {} },
    });
    const client = await connectClient(owner);
    const result = await client.list();
    expect(result.rows).toEqual(rows);
    expect(result.revision).toBe(1);
  });
});
