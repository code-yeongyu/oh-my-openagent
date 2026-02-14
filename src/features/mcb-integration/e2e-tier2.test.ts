import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { resolve } from "path"
import { callMcbTool, createDefaultArgs, createMcbTestClient, parseMcbToolResponse, type McbTestClient } from "./mcb-client-helper"

const mcbAvailable = Bun.which("mcb") !== null
const configPath = resolve(import.meta.dir, "test-mcb.toml")
const dbPath = `/tmp/mcb-e2e-tier2-${Date.now()}.db`

describe.skipIf(!mcbAvailable)("mcb-integration: e2e tier2 core tool invocation", () => {
  let testClient: McbTestClient

  beforeAll(async () => {
    testClient = await createMcbTestClient(60_000, configPath, {
      MCP__AUTH__USER_DB_PATH: dbPath,
    })
  }, 60_000)

  afterAll(async () => {
    await testClient?.close()
  })

  //#given a memory store call without execution provenance
  //#when store is requested for observation resource
  //#then mcb rejects the call with invalid_params provenance error
  test("memory store without execution provenance returns invalid_params", async () => {
    const args = {
      ...createDefaultArgs("memory"),
      action: "store",
      resource: "observation",
      data: { content: "e2e test observation", source: "oh-my-opencode", observation_type: "code" },
      _meta: {},
    }
    const result = await callMcbTool(testClient.client, "memory", args)
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]?.type).toBe("text")
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Missing execution provenance")
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

  //#given validate tool invocation with list_rules
  //#when called with current mcb 0.2.1-dev configuration
  //#then mcb returns a successful rules payload (currently empty in local config)
  test("validate list_rules returns successful payload", async () => {
    const result = await callMcbTool(testClient.client, "validate", createDefaultArgs("validate"))
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0]?.type).toBe("text")
    expect(result.isError).toBe(false)
    const parsed = parseMcbToolResponse(result) as Record<string, unknown>
    expect(typeof parsed.count).toBe("number")
    expect(Array.isArray(parsed.rules)).toBe(true)
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
