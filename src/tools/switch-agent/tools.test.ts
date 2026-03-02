/// <reference types="bun-types" />

import { describe, test, expect, beforeEach } from "bun:test"
import { createSwitchAgentTool } from "./tools"

describe("switch_agent tool", () => {
  const sessionID = "test-session-123"
  const messageID = "msg-456"
  const agent = "athena"

  const toolContext = {
    sessionID,
    messageID,
    agent,
    abort: new AbortController().signal,
  }

  let createdSessions: Array<{ body?: { parentID?: string; title?: string } }>
  let promptedSessions: Array<{ path: { id: string }; body: { agent?: string; parts: Array<{ type: "text"; text: string }> } }>

  beforeEach(() => {
    createdSessions = []
    promptedSessions = []
  })

  function createToolWithMockClient(overrides?: {
    createImpl?: () => Promise<unknown>
    promptAsyncImpl?: (input: any) => Promise<unknown>
  }) {
    const client = {
      session: {
        create: overrides?.createImpl ?? (async (input?: { body?: { parentID?: string; title?: string } }) => {
          createdSessions.push(input ?? {})
          return { data: { id: "new-session-abc" } }
        }),
        promptAsync: overrides?.promptAsyncImpl ?? (async (input: any) => {
          promptedSessions.push(input)
          return undefined
        }),
      },
    }

    return createSwitchAgentTool({ client })
  }

  //#given valid atlas switch args
  //#when execute is called
  //#then it creates a new session and prompts with the target agent
  test("should create session and prompt for atlas switch", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "atlas", context: "Fix the auth bug based on council findings" },
      toolContext
    )

    expect(result).toContain("atlas")
    expect(result).toContain("new-session-abc")
    expect(createdSessions).toHaveLength(1)
    expect(promptedSessions).toHaveLength(1)
    expect(promptedSessions[0]!.path.id).toBe("new-session-abc")
    expect(promptedSessions[0]!.body.agent).toContain("Atlas")
    expect(promptedSessions[0]!.body.parts[0]!.text).toBe("Fix the auth bug based on council findings")
  })

  //#given valid prometheus switch args
  //#when execute is called
  //#then it creates a new session and prompts with prometheus agent
  test("should create session and prompt for prometheus switch", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "Prometheus", context: "Create a plan for the refactoring" },
      toolContext
    )

    expect(result).toContain("prometheus")
    expect(promptedSessions).toHaveLength(1)
    expect(promptedSessions[0]!.body.parts[0]!.text).toBe("Create a plan for the refactoring")
  })

  //#given valid hephaestus switch args
  //#when execute is called
  //#then it creates a new session for hephaestus
  test("should create session and prompt for hephaestus switch", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "Hephaestus", context: "Implement the selected diagnosis fix" },
      toolContext
    )

    expect(result).toContain("hephaestus")
    expect(createdSessions).toHaveLength(1)
    expect(promptedSessions).toHaveLength(1)
  })

  //#given valid sisyphus switch args
  //#when execute is called
  //#then it creates a new session for sisyphus
  test("should create session and prompt for sisyphus switch", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "Sisyphus", context: "Implement the selected diagnosis fix" },
      toolContext
    )

    expect(result).toContain("sisyphus")
    expect(createdSessions).toHaveLength(1)
    expect(promptedSessions).toHaveLength(1)
  })

  //#given an invalid agent name
  //#when execute is called
  //#then it returns an error without creating a session
  test("should reject invalid agent names", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "librarian", context: "Some context" },
      toolContext
    )

    expect(result).toContain("Invalid switch target")
    expect(result).toContain("librarian")
    expect(createdSessions).toHaveLength(0)
    expect(promptedSessions).toHaveLength(0)
  })

  //#given agent name with different casing
  //#when execute is called
  //#then it normalizes to lowercase and creates session
  test("should handle case-insensitive agent names", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "ATLAS", context: "Fix things" },
      toolContext
    )

    expect(result).toContain("atlas")
    expect(createdSessions).toHaveLength(1)
    expect(promptedSessions).toHaveLength(1)
  })

  //#given session.create fails
  //#when execute is called
  //#then it returns an error message
  test("should handle session creation failure gracefully", async () => {
    const tool = createToolWithMockClient({
      createImpl: async () => { throw new Error("connection refused") },
    })
    const result = await tool.execute(
      { agent: "atlas", context: "Fix things" },
      toolContext
    )

    expect(result).toContain("Failed to create handoff session")
    expect(result).toContain("connection refused")
    expect(promptedSessions).toHaveLength(0)
  })

  //#given promptAsync fails
  //#when execute is called
  //#then it returns a warning but still reports session created
  test("should handle prompt delivery failure gracefully", async () => {
    const tool = createToolWithMockClient({
      promptAsyncImpl: async () => { throw new Error("prompt failed") },
    })
    const result = await tool.execute(
      { agent: "atlas", context: "Fix things" },
      toolContext
    )

    expect(result).toContain("new-session-abc")
    expect(result).toContain("warning: prompt delivery failed")
    expect(createdSessions).toHaveLength(1)
  })

  //#given session.create returns response with id at root level
  //#when execute is called
  //#then it extracts the session ID correctly
  test("should extract session ID from root-level response", async () => {
    const tool = createToolWithMockClient({
      createImpl: async () => ({ id: "direct-id-123" }),
    })
    const result = await tool.execute(
      { agent: "atlas", context: "Fix things" },
      toolContext
    )

    expect(result).toContain("direct-id-123")
    expect(promptedSessions[0]!.path.id).toBe("direct-id-123")
  })

  //#given valid athena switch args
  //#when execute is called
  //#then it creates a new session and prompts with the athena agent
  test("should create session and prompt for athena switch", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "athena", context: "Run council analysis on the architecture decision" },
      toolContext
    )

    expect(result).toContain("athena")
    expect(result).toContain("new-session-abc")
    expect(createdSessions).toHaveLength(1)
    expect(promptedSessions).toHaveLength(1)
    expect(promptedSessions[0]!.path.id).toBe("new-session-abc")
    expect(promptedSessions[0]!.body.parts[0]!.text).toBe("Run council analysis on the architecture decision")
  })
})
