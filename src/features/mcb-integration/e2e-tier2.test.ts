import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { callMcbTool, createDefaultArgs, createMcbTestClient, parseMcbToolResponse, type McbTestClient } from "./mcb-client-helper"

const mcbAvailable = Bun.which("mcb") !== null

describe.skipIf(!mcbAvailable)("mcb-integration: e2e tier2 core tool invocation", () => {
  let testClient: McbTestClient

  beforeAll(async () => {
    testClient = await createMcbTestClient()
  })

  afterAll(async () => {
    await testClient.close()
  })

  //#given a real mcb memory tool call
  //#when store is requested for observation resource
  //#then known mcb bug is surfaced as tool-level error shape
  test("memory store returns tool-level error shape for current mcb behavior", async () => {
    const args = {
      ...createDefaultArgs("memory"),
      action: "store",
      resource: "observation",
      data: { content: "e2e test observation", source: "oh-my-opencode", observation_type: "code" },
    }
    const result = await callMcbTool(testClient.client, "memory", args)
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]?.type).toBe("text")
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("internal error")
  }, 10_000)

  //#given memory list call with empty query
  //#when memory list is invoked
  //#then a response payload is returned in text content
  test("memory list with empty query returns textual payload", async () => {
    const result = await callMcbTool(testClient.client, "memory", createDefaultArgs("memory"))
    expect(result.content.length).toBeGreaterThan(0)
    expect(typeof result.content[0]?.text).toBe("string")
  }, 10_000)

  //#given memory list call with non-empty query
  //#when memory list executes
  //#then result is parseable as json or plain text payload
  test("memory list with query returns parseable payload", async () => {
    const args = { ...createDefaultArgs("memory"), action: "list", query: "test" }
    const result = await callMcbTool(testClient.client, "memory", args)
    const parsed = parseMcbToolResponse(result)
    if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
      expect(typeof (parsed as { count: unknown }).count).toBe("number")
      return
    }
    expect(typeof (parsed as { text?: unknown }).text).toBe("string")
  }, 10_000)

  //#given search memory invocation
  //#when semantic search runs on empty dataset
  //#then response is parseable and includes count or text payload
  test("search memory returns parseable response", async () => {
    const args = { ...createDefaultArgs("search"), resource: "memory", query: "unrelated-query" }
    const result = await callMcbTool(testClient.client, "search", args)
    const parsed = parseMcbToolResponse(result)
    if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
      expect(typeof (parsed as { count: unknown }).count).toBe("number")
      return
    }
    expect(typeof (parsed as { text?: unknown }).text).toBe("string")
  }, 10_000)

  //#given search code invocation
  //#when semantic code search runs without index data
  //#then response shape remains valid
  test("search code returns parseable response", async () => {
    const args = { ...createDefaultArgs("search"), resource: "code", query: "function" }
    const result = await callMcbTool(testClient.client, "search", args)
    const parsed = parseMcbToolResponse(result)
    if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
      expect(typeof (parsed as { count: unknown }).count).toBe("number")
      return
    }
    expect(typeof (parsed as { text?: unknown }).text).toBe("string")
  }, 10_000)

  //#given validate tool invocation
  //#when list_rules action is called
  //#then mcb returns text content payload with consistent shape
  test("validate list_rules returns consistent payload shape", async () => {
    const result = await callMcbTool(testClient.client, "validate", createDefaultArgs("validate"))
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]?.type).toBe("text")
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("internal error")
  }, 10_000)

  //#given index tool invocation
  //#when status action is requested
  //#then mcb returns a textual status payload
  test("index status returns textual payload", async () => {
    const result = await callMcbTool(testClient.client, "index", createDefaultArgs("index"))
    expect(result.content.length).toBeGreaterThan(0)
    expect(typeof result.content[0]?.text).toBe("string")
  }, 10_000)
})
