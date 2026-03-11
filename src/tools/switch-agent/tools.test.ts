/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { createSwitchAgentTool, switchAgent } from "./tools"
import type {
  HandoffSourceAgent,
  SessionMessage,
  SwitchAgentClient,
} from "./types"

const sessionID = "test-session-123"
const messageID = "msg-456"
const agent = "athena"

const toolContext = {
  sessionID,
  messageID,
  agent,
  abort: new AbortController().signal,
}

const currentAgent: HandoffSourceAgent = {
  name: agent,
  sessionID,
  messageID,
}

describe("switch_agent tool", () => {
  let createdSessions: Array<{ body?: { parentID?: string; title?: string } }>
  let promptedSessions: Array<{
    path: { id: string }
    body: { agent?: string; parts: Array<{ type: "text"; text: string }> }
  }>
  let navigatedSessions: string[]

  beforeEach(() => {
    createdSessions = []
    promptedSessions = []
    navigatedSessions = []
  })

  function createMessages(): SessionMessage[] {
    return [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "User asked to fix auth refresh." }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Athena confirmed the session token is not refreshed." }],
      },
    ]
  }

  function createMockClient(overrides?: {
    createImpl?: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
    promptAsyncImpl?: (input: {
      path: { id: string }
      body: { agent?: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    messagesImpl?: (input: { path: { id: string } }) => Promise<unknown>
    postImpl?: (input: { url: string; body: { sessionID: string } }) => Promise<unknown>
  }): SwitchAgentClient & {
    _client: {
      post: (input: { url: string; body: { sessionID: string } }) => Promise<unknown>
    }
  } {
    return {
      session: {
        create: overrides?.createImpl ?? (async (input) => {
          createdSessions.push(input ?? {})
          return { data: { id: "new-session-abc" } }
        }),
        promptAsync: overrides?.promptAsyncImpl ?? (async (input) => {
          promptedSessions.push(input)
          return undefined
        }),
        messages: overrides?.messagesImpl ?? (async () => ({ data: createMessages() })),
      },
      _client: {
        post: overrides?.postImpl ?? (async (input) => {
          navigatedSessions.push(input.body.sessionID)
          return undefined
        }),
      },
    }
  }

  function createToolWithMockClient(overrides?: Parameters<typeof createMockClient>[0]) {
    return createSwitchAgentTool({ client: createMockClient(overrides) })
  }

  test("creates an explicit handoff with preserved session context", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "atlas", context: "Fix the auth bug based on council findings" },
      toolContext,
    )

    expect(result).toContain("Agent switch to atlas initiated")
    expect(result).toContain("new-session-abc")
    expect(result).toContain("Navigated TUI to new session")
    expect(createdSessions).toEqual([
      {
        body: {
          parentID: sessionID,
          title: "Handoff: athena -> atlas",
        },
      },
    ])
    expect(promptedSessions).toHaveLength(1)
    expect(promptedSessions[0]?.body.agent).toContain("Atlas")
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain("Fix the auth bug based on council findings")
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain(`Source session: ${sessionID}`)
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain(`Source message: ${messageID}`)
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain("- user: User asked to fix auth refresh.")
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain("- assistant: Athena confirmed the session token is not refreshed.")
    expect(navigatedSessions).toEqual(["new-session-abc"])
  })

  test("rejects invalid agent names before creating a handoff session", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "librarian", context: "Some context" },
      toolContext,
    )

    expect(result).toContain('Invalid target agent: "librarian"')
    expect(createdSessions).toHaveLength(0)
    expect(promptedSessions).toHaveLength(0)
  })

  test("continues the handoff when preserved message lookup fails", async () => {
    const tool = createToolWithMockClient({
      messagesImpl: async () => {
        throw new Error("message fetch failed")
      },
    })

    const result = await tool.execute(
      { agent: "sisyphus", context: "Handle the remaining implementation work" },
      toolContext,
    )

    expect(result).toContain("new-session-abc")
    expect(result).toContain("session.messages failed: message fetch failed")
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain(`Source session: ${sessionID}`)
    expect(promptedSessions[0]?.body.parts[0]?.text).not.toContain("Recent session context:")
  })

  test("supports explicit handoff without preserving prior messages", async () => {
    const result = await switchAgent(
      createMockClient(),
      currentAgent,
      {
        targetAgent: "hephaestus",
        preserveContext: false,
        handoffMessage: "Goal: complete the implementation autonomously.",
      },
    )

    expect(result).toMatchObject({
      success: true,
      previousAgent: "athena",
      currentAgent: "hephaestus",
      contextPreserved: false,
      newSessionID: "new-session-abc",
    })
    expect(promptedSessions[0]?.body.parts[0]?.text).toContain("Goal: complete the implementation autonomously.")
    expect(promptedSessions[0]?.body.parts[0]?.text).not.toContain("Recent session context:")
  })

  test("validates target agent existence in the typed handoff helper", async () => {
    try {
      await switchAgent(createMockClient(), currentAgent, {
        targetAgent: "athena",
        handoffMessage: "Should fail",
      })
      throw new Error("Expected switchAgent to reject invalid target agent")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Invalid target agent: "athena"')
    }
  })

  test("extracts the session id from root-level create responses", async () => {
    const tool = createToolWithMockClient({
      createImpl: async (input) => {
        createdSessions.push(input ?? {})
        return { id: "direct-id-123" }
      },
    })

    const result = await tool.execute(
      { agent: "atlas", context: "Fix things" },
      toolContext,
    )

    expect(result).toContain("direct-id-123")
    expect(promptedSessions[0]?.path.id).toBe("direct-id-123")
  })
})
