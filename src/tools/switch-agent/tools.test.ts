/// <reference types="bun-types" />

import { describe, test, expect, beforeEach } from "bun:test"
import { createSwitchAgentTool } from "./tools"
import { consumePendingSwitch, _resetForTesting as resetSwitch } from "../../features/agent-switch"
import { getSessionAgent, _resetForTesting as resetSession } from "../../features/claude-code-session-state"

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

  beforeEach(() => {
    resetSwitch()
    resetSession()
  })

  function createToolWithMockClient(promptImpl?: () => Promise<unknown>) {
    const client = {
      session: {
        promptAsync:
          promptImpl ??
          (async () => {
            return undefined
          }),
        messages: async () => ({ data: [] }),
      },
    }

    return createSwitchAgentTool({
      client: client as unknown as {
        session: {
          promptAsync: (input: {
            path: { id: string }
            body: { agent: string; parts: Array<{ type: "text"; text: string }> }
          }) => Promise<unknown>
          messages: (input: { path: { id: string } }) => Promise<unknown>
        }
      },
    })
  }

  //#given valid atlas switch args
  //#when execute is called
  //#then it stores pending switch and updates session agent
  test("should queue switch to atlas", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "atlas", context: "Fix the auth bug based on council findings" },
      toolContext
    )

    expect(result).toContain("atlas")
    expect(result).toContain("switch")

    const entry = consumePendingSwitch(sessionID)
    expect(entry).toEqual({
      agent: "atlas",
      context: "Fix the auth bug based on council findings",
    })

    expect(getSessionAgent(sessionID)).toBe("atlas")
  })

  //#given valid prometheus switch args
  //#when execute is called
  //#then it stores pending switch for prometheus
  test("should queue switch to prometheus", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "Prometheus", context: "Create a plan for the refactoring" },
      toolContext
    )

    expect(result).toContain("prometheus")
    expect(result).toContain("switch")

    const entry = consumePendingSwitch(sessionID)
    expect(entry?.agent).toBe("prometheus")
  })

  //#given an invalid agent name
  //#when execute is called
  //#then it returns an error
  test("should reject invalid agent names", async () => {
    const tool = createToolWithMockClient()
    const result = await tool.execute(
      { agent: "librarian", context: "Some context" },
      toolContext
    )

    expect(result).toContain("Invalid switch target")
    expect(result).toContain("librarian")
    expect(consumePendingSwitch(sessionID)).toBeUndefined()
  })

  //#given agent name with different casing
  //#when execute is called
  //#then it normalizes to lowercase
  test("should handle case-insensitive agent names", async () => {
    const tool = createToolWithMockClient()
    await tool.execute(
      { agent: "ATLAS", context: "Fix things" },
      toolContext
    )

    const entry = consumePendingSwitch(sessionID)
    expect(entry?.agent).toBe("atlas")
    expect(getSessionAgent(sessionID)).toBe("atlas")
  })
})
