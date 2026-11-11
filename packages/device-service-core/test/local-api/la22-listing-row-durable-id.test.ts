import { afterEach, describe, expect, test } from "bun:test"
import type { ListingRow } from "../../src/local-api/protocol.ts"
import { validateEvent, validateRequest } from "../../src/local-api/validate.ts"
import { defaultWorld } from "./conformance/world.ts"
import { cleanup, connectClient, startOwner } from "./support.ts"

afterEach(cleanup)

const world = defaultWorld()
const base = world.listing.revisions[1]?.rows[0]
if (base === undefined) throw new Error("the default world lists no row")
const DURABLE_ID = "01a1c4a5-d69c-782e-8ba3-35d287b03e34"
const withDurable: ListingRow = { ...base, durable_id: DURABLE_ID }
const rowsEvent = (rows: readonly unknown[]) => ({
  type: "event" as const,
  kind: "sessions.listing_rows" as const,
  query_id: "q1",
  revision: 1,
  rows,
})

describe("LA22 listing rows carry an optional durable_id (#12996), asked for with rows: 3", () => {
  test("sessions.list accepts rows 2 and 3 and refuses any other rows version", () => {
    for (const rows of [2, 3])
      expect(validateRequest({ id: "1", type: "sessions.list", rows })).toMatchObject({
        ok: true,
        request: { rows },
      })
    for (const rows of [1, 4, "3"])
      expect(validateRequest({ id: "1", type: "sessions.list", rows }), String(rows)).toMatchObject({
        ok: false,
      })
  })

  test("a row with durable_id validates and survives a serialize round trip", () => {
    const event = rowsEvent([withDurable])
    const wire = JSON.parse(JSON.stringify(event))
    expect<unknown>(validateEvent(wire)).toEqual(event)
  })

  test("a row without durable_id stays valid and gains no durable_id", () => {
    const validated = validateEvent(rowsEvent([base]))
    if (validated.kind !== "sessions.listing_rows") throw new Error(validated.kind)
    expect(validated.rows[0]).toEqual(base)
    expect(Object.hasOwn(validated.rows[0] ?? {}, "durable_id")).toBe(false)
  })

  test("an empty, over-long or non-string durable_id is refused", () => {
    for (const durable_id of ["", "d".repeat(129), 7, null])
      expect(() => validateEvent(rowsEvent([{ ...base, durable_id }])), String(durable_id)).toThrow()
    expect(validateEvent(rowsEvent([{ ...base, durable_id: "d".repeat(128) }]))).toBeDefined()
  })

  test("a client assembles a listing whose rows carry durable_id", async () => {
    const rows: readonly ListingRow[] = [withDurable, base]
    const owner = await startOwner({
      ...world,
      listing: { revisions: [{ rows, incomplete: [] }], devices: {} },
    })
    const client = await connectClient(owner)
    const result = await client.list(undefined, undefined, 3)
    expect(result.rows).toEqual(rows)
  })
})
