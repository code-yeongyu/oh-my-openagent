import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "./constants"
import { resolveSubagentSpawnContext } from "./subagent-spawn-limits"

function createMockClient(sessionGet: OpencodeClient["session"]["get"]): OpencodeClient {
  return {
    session: {
      get: sessionGet,
    },
  } as OpencodeClient
}

describe("resolveSubagentSpawnContext", () => {
  describe("#given session.get returns an SDK error response", () => {
    test("throws a fail-closed spawn blocked error", async () => {
      // given
      const client = createMockClient(async () => ({
        error: "lookup failed",
        data: undefined,
      }))

      // when
      const result = resolveSubagentSpawnContext(client, "parent-session")

      // then
      await expect(result).rejects.toThrow(/background_task\.maxDescendants cannot be enforced safely.*lookup failed/)
    })
  })

  describe("#given session.get returns no session data", () => {
    test("throws a fail-closed spawn blocked error", async () => {
      // given
      const client = createMockClient(async () => ({
        data: undefined,
      }))

      // when
      const result = resolveSubagentSpawnContext(client, "parent-session")

      // then
      await expect(result).rejects.toThrow(/background_task\.maxDescendants cannot be enforced safely.*No session data returned/)
    })
  })
})
