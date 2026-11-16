/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { roleLookup, TICKET_URL, ticketLookup } from "../.github/workflows/operator-darwin-services.ts"

/**
 * Release security contract (#13943, review LOW-1 and push-2 NIT-2): the notarization ticket answer must be about
 * exactly the cdhash asked for, and every network or service failure of the ticket and role lookups is a typed
 * refusal (one `::error::... refused:` line), never a crash and never a pass.
 */

const CDHASH = "a".repeat(40)
type Reply = { status?: number; body?: unknown; throws?: boolean; raw?: string }
const fetcher = (reply: Reply, seen: string[] = []) => async (url: string, init?: RequestInit) => {
  seen.push(`${url} ${String(init?.body ?? "")}`)
  if (reply.throws) throw new TypeError("fetch failed")
  return new Response(reply.raw ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 })
}
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    (value) => `RESOLVED ${String(value)}`,
    (error: Error) => `${error.constructor.name}: ${error.message}`,
  )

describe("Apple notarization ticket lookup", () => {
  test("asks for 2/2/<cdhash> and accepts a signed ticket for that record", async () => {
    const seen: string[] = []
    const lookup = ticketLookup(fetcher({ body: { records: [{ recordName: `2/2/${CDHASH}`, fields: { signedTicket: { value: "AAAA" } } }] } }, seen))
    expect(await outcome(lookup(CDHASH))).toBe("RESOLVED true")
    expect(seen).toEqual([`${TICKET_URL} ${JSON.stringify({ records: [{ recordName: `2/2/${CDHASH}` }] })}`])
  })

  test("reports a missing ticket as false, which the verifier refuses", async () => {
    const lookup = ticketLookup(fetcher({ body: { records: [{ recordName: `2/2/${CDHASH}`, serverErrorCode: "NOT_FOUND" }] } }))
    expect(await outcome(lookup(CDHASH))).toBe("RESOLVED false")
  })

  const refusals: Array<[string, Reply, string]> = [
    ["a network failure", { throws: true }, `could not reach Apple's notarization ticket service for cdhash ${CDHASH}`],
    ["an HTTP error", { status: 503, body: {} }, `Apple's notarization ticket service answered HTTP 503 for cdhash ${CDHASH}`],
    ["a non-JSON answer", { raw: "<html>" }, "Apple's notarization ticket service returned no JSON (HTTP 200)"],
    ["an answer about another cdhash", { body: { records: [{ recordName: `2/2/${"b".repeat(40)}`, fields: { signedTicket: { value: "AAAA" } } }] } }, `Apple's notarization ticket service did not answer for record 2/2/${CDHASH}`],
    ["two records", { body: { records: [{ recordName: `2/2/${CDHASH}` }, { recordName: `2/2/${CDHASH}` }] } }, `Apple's notarization ticket service did not answer for record 2/2/${CDHASH}`],
    ["another server error", { body: { records: [{ recordName: `2/2/${CDHASH}`, serverErrorCode: "INTERNAL_ERROR" }] } }, `Apple's notarization ticket service answered INTERNAL_ERROR for cdhash ${CDHASH}`],
  ]
  for (const [name, reply, reason] of refusals) {
    test(`refuses ${name}`, async () => {
      expect(await outcome(ticketLookup(fetcher(reply))(CDHASH))).toBe(`Refusal: ${reason}`)
    })
  }
})

describe("GitHub collaborator role lookup", () => {
  test("returns role_name", async () => {
    expect(await outcome(roleLookup("o/r", "t", fetcher({ body: { role_name: "maintain" } }))("maintainer"))).toBe("RESOLVED maintain")
  })

  test("an HTTP error is an unreadable role (null), which the verifier refuses", async () => {
    expect(await outcome(roleLookup("o/r", "t", fetcher({ status: 404, body: {} }))("stranger"))).toBe("RESOLVED null")
  })

  test("push-2 NIT-2: a network failure is a typed refusal, not a crash", async () => {
    expect(await outcome(roleLookup("o/r", "t", fetcher({ throws: true }))("maintainer"))).toBe("Refusal: could not read the repository permission of maintainer")
  })
})
