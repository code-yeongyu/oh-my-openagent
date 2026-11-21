import { afterEach, describe, expect, test } from "bun:test"
import type { ListingRow, ListingWait } from "../../src/local-api/protocol.ts"
import { validateEvent } from "../../src/local-api/validate.ts"
import { defaultWorld } from "./conformance/world.ts"
import { cleanup, connectClient, startOwner } from "./support.ts"

afterEach(cleanup)

const world = defaultWorld()
const base = world.listing.revisions[1]?.rows[0]
if (base === undefined) throw new Error("the default world lists no row")
const WAITING: ListingWait = {
  kind: "retry",
  attempt: 1,
  maxAttempts: 3,
  delayMs: 0,
  until: "2026-11-21T01:30:00.000Z",
}
const held: ListingRow = { ...base, waiting: WAITING, engine_version: "v".repeat(128) }
const rowsEvent = (rows: readonly unknown[]) => ({
  type: "event" as const,
  kind: "sessions.listing_rows" as const,
  query_id: "q1",
  revision: 1,
  rows,
})

describe("LA23 listing rows carry the holder's retry wait at rows 6 and engine version at rows 7 (relay-daemon#1480)", () => {
  test("a row with waiting and a 128-character engine_version validates and survives a serialize round trip", () => {
    const event = rowsEvent([held])
    expect<unknown>(validateEvent(JSON.parse(JSON.stringify(event)))).toEqual(event)
  })

  test("an out-of-bounds engine_version is refused", () => {
    for (const engine_version of ["", "v".repeat(129), 7, null])
      expect(() => validateEvent(rowsEvent([{ ...base, engine_version }])), String(engine_version)).toThrow()
  })

  test("a malformed waiting is refused", () => {
    const malformed: readonly unknown[] = [
      null,
      "rate_limit",
      { ...WAITING, kind: "backoff" },
      { ...WAITING, attempt: 4 },
      { ...WAITING, attempt: 0 },
      { ...WAITING, maxAttempts: 0, attempt: 0 },
      { ...WAITING, delayMs: -1 },
      { ...WAITING, until: "2026-11-21T01:30:00Z" },
      { ...WAITING, until: "soon" },
      { kind: WAITING.kind, attempt: 1, maxAttempts: 3, delayMs: 0 },
    ]
    for (const waiting of malformed)
      expect(() => validateEvent(rowsEvent([{ ...base, waiting }])), JSON.stringify(waiting)).toThrow()
  })

  test("a client listing at rows 7 gets both fields, at rows 6 the wait only", async () => {
    const owner = await startOwner({
      ...world,
      listing: { revisions: [{ rows: [held], incomplete: [] }], devices: {} },
    })
    const client = await connectClient(owner)
    expect((await client.list(undefined, undefined, 7)).rows).toEqual([held])
    const [sixth] = (await client.list(undefined, undefined, 6)).rows
    expect(sixth?.waiting).toEqual(WAITING)
    expect(sixth).not.toHaveProperty("engine_version")
  })
})
