import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "./constants"
import {
  assertOpenCodeSpawnAdmission,
  discoverSubagentLineage,
  OpenCodeSpawnAdmissionError,
} from "./subagent-spawn-limits"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createMockClient(sessionGet: OpencodeClient["session"]["get"]): OpencodeClient {
  return unsafeTestValue({ session: { get: sessionGet } })
}

function assertAdmission(client: OpencodeClient, parentSessionID: string) {
  return assertOpenCodeSpawnAdmission({
    client,
    request: {
      parentSessionID,
      parentAgent: "sisyphus",
      targetAgent: "explore",
    },
  })
}

describe("OpenCode spawn admission", () => {
  test("passes directory to every authoritative lineage lookup", async () => {
    const sessionGetCalls: Array<Record<string, unknown>> = []
    const client = createMockClient(unsafeTestValue<OpencodeClient["session"]["get"]>(async (input) => {
      sessionGetCalls.push(input)
      return input.path.id === "child-session"
        ? { data: { id: "child-session", parentID: "root-session" } }
        : { data: { id: "root-session" } }
    }))

    const lineage = await discoverSubagentLineage(client, "child-session", "/project/root")

    expect(lineage).toEqual({ lineage: "known", currentDepth: 1, rootSessionID: "root-session" })
    expect(sessionGetCalls).toEqual([
      { path: { id: "child-session" }, query: { directory: "/project/root" } },
      { path: { id: "root-session" }, query: { directory: "/project/root" } },
    ])
  })

  test("denies missing parent records before spawn", async () => {
    const client = createMockClient(unsafeTestValue<OpencodeClient["session"]["get"]>(async () => ({
      error: "missing session",
      data: undefined,
    })))

    await expect(assertAdmission(client, "missing-session")).rejects.toMatchObject({
      name: OpenCodeSpawnAdmissionError.name,
      decision: { reason: "unknown_lineage" },
    })
  })

  test("denies a cycle before spawn", async () => {
    const client = createMockClient(unsafeTestValue<OpencodeClient["session"]["get"]>(async (input) => ({
      data: input.path.id === "first"
        ? { id: "first", parentID: "second" }
        : { id: "second", parentID: "first" },
    })))

    await expect(assertAdmission(client, "first")).rejects.toMatchObject({
      name: OpenCodeSpawnAdmissionError.name,
      decision: { reason: "unknown_lineage" },
    })
  })

  test("denies a second nesting level before spawn", async () => {
    const client = createMockClient(unsafeTestValue<OpencodeClient["session"]["get"]>(async (input) => ({
      data: input.path.id === "child"
        ? { id: "child", parentID: "root" }
        : { id: "root" },
    })))

    await expect(assertAdmission(client, "child")).rejects.toMatchObject({
      name: OpenCodeSpawnAdmissionError.name,
      decision: { reason: "depth_exceeded" },
    })
  })
})
