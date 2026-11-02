import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { isSyncSessionDeleted } from "./sync-session-existence"
import type { OpencodeClient } from "./types"

type LookupCase = {
  readonly name: string
  readonly get: () => Promise<unknown>
  readonly deleted: boolean
}

const cases: readonly LookupCase[] = [
  { name: "SDK NotFoundError body", get: async () => ({ data: undefined, error: { name: "NotFoundError", data: { message: "Session not found: ses_x" } } }), deleted: true },
  { name: "response error with status 404", get: async () => ({ data: undefined, error: { status: 404, message: "Not Found" } }), deleted: true },
  { name: "thrown error with status 404", get: async () => { throw Object.assign(new Error("Not Found"), { status: 404 }) }, deleted: true },
  { name: "thrown NotFoundError", get: async () => { throw Object.assign(new Error("Session not found"), { name: "NotFoundError" }) }, deleted: true },
  { name: "existing session", get: async () => ({ data: { id: "ses_x" } }), deleted: false },
  { name: "response error with status 500", get: async () => ({ data: undefined, error: { status: 500, message: "Internal Server Error" } }), deleted: false },
  { name: "response error whose message contains missing", get: async () => ({ data: undefined, error: { status: 500, message: "storage shard missing, retry later" } }), deleted: false },
  { name: "response error whose message contains not found", get: async () => ({ data: undefined, error: { message: "upstream route not found" } }), deleted: false },
  { name: "thrown error whose message contains missing", get: async () => { throw new Error("required header missing") }, deleted: false },
  { name: "thrown network error", get: async () => { throw new Error("fetch failed: ECONNREFUSED") }, deleted: false },
  { name: "thrown non-object", get: async () => { throw "socket hang up" }, deleted: false },
]

describe("isSyncSessionDeleted", () => {
  for (const testCase of cases) {
    test(`#given ${testCase.name} #when checking #then deleted is ${testCase.deleted}`, async () => {
      // given
      const client = unsafeTestValue<OpencodeClient>({ session: { get: testCase.get } })

      // when
      const deleted = await isSyncSessionDeleted(client, "ses_x")

      // then
      expect(deleted).toBe(testCase.deleted)
    })
  }

  test("#given a client without session.get #when checking #then the session is not treated as deleted", async () => {
    // given
    const client = unsafeTestValue<OpencodeClient>({ session: {} })

    // when
    const deleted = await isSyncSessionDeleted(client, "ses_x")

    // then
    expect(deleted).toBe(false)
  })
})
