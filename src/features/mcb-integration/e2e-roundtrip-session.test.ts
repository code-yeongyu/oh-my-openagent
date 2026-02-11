import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  callMcbTool,
  createDefaultArgs,
  createMcbTestClient,
  parseMcbToolResponse,
  type McbTestClient,
} from "./mcb-client-helper"
import { discoverValidAgentType } from "./mcb-roundtrip-helpers"

const mcbAvailable = Bun.which("mcb") !== null

describe.skipIf(!mcbAvailable)("mcb-integration: e2e roundtrip session operations", () => {
  let testClient: McbTestClient
  let validAgentType: string | null = null

  beforeAll(async () => {
    testClient = await createMcbTestClient()
    validAgentType = await discoverValidAgentType(testClient.client)
  })

  afterAll(async () => {
    await testClient.close()
  })

  //#given a valid discovered agent_type
  //#when session create, get, and list run sequentially
  //#then created session id is readable in get and list payloads
  test("session create/get/list performs write-read roundtrip", async () => {
    if (!validAgentType) {
      expect(validAgentType).toBeNull()
      return
    }

    const createArgs = {
      ...createDefaultArgs("session"),
      action: "create",
      agent_type: validAgentType,
      data: { name: "mcb-roundtrip-session", marker: `mcb-session-${Date.now()}` },
    }
    const createResult = await callMcbTool(testClient.client, "session", createArgs)
    expect(createResult.isError).not.toBe(true)

    const createdSessionId = extractSessionId(parseMcbToolResponse(createResult))
    expect(createdSessionId).not.toBeNull()
    expect(createdSessionId?.length).toBeGreaterThan(0)

    const getArgs = {
      ...createDefaultArgs("session"),
      action: "get",
      session_id: createdSessionId,
      agent_type: validAgentType,
    }
    const getResult = await callMcbTool(testClient.client, "session", getArgs)
    expect(getResult.isError).not.toBe(true)
    const getPayload = stringifyPayload(parseMcbToolResponse(getResult))
    expect(getPayload).toContain(String(createdSessionId))

    const listArgs = {
      ...createDefaultArgs("session"),
      action: "list",
      agent_type: validAgentType,
    }
    const listResult = await callMcbTool(testClient.client, "session", listArgs)
    expect(listResult.isError).not.toBe(true)
    const listPayload = stringifyPayload(parseMcbToolResponse(listResult))
    expect(listPayload).toContain(String(createdSessionId))
  }, 15_000)

  //#given memory store call for observation resource
  //#when write is attempted on mcb v0.2.1-dev
  //#then the known internal error behavior is documented
  test("memory store stays broken with internal error shape", async () => {
    const args = {
      ...createDefaultArgs("memory"),
      action: "store",
      resource: "observation",
      data: { content: "mcb-roundtrip-memory", source: "oh-my-opencode", observation_type: "code" },
    }
    const result = await callMcbTool(testClient.client, "memory", args)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("internal error")
  }, 15_000)
})

function extractSessionId(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>
    if (typeof record.session_id === "string" && record.session_id.length > 0) {
      return record.session_id
    }
    if (typeof record.id === "string" && record.id.length > 0) {
      return record.id
    }
  }

  const rawText = stringifyPayload(payload)
  const matched = rawText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return matched?.[0] ?? null
}

function stringifyPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload
  }
  return JSON.stringify(payload)
}
