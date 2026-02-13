import { describe, test, expect, beforeEach } from "bun:test"
import { createSessionHandoffTool } from "./tools"
import { consumePendingHandoff, _resetForTesting as resetHandoff } from "../../features/agent-handoff"
import { getSessionAgent, _resetForTesting as resetSession } from "../../features/claude-code-session-state"

describe("session_handoff tool", () => {
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
    resetHandoff()
    resetSession()
  })

  //#given valid atlas handoff args
  //#when execute is called
  //#then it stores pending handoff and updates session agent
  test("should queue handoff to atlas", async () => {
    const tool = createSessionHandoffTool()
    const result = await tool.execute(
      { agent: "atlas", context: "Fix the auth bug based on council findings" },
      toolContext
    )

    expect(result).toContain("atlas")
    expect(result).toContain("Handoff queued")

    const handoff = consumePendingHandoff(sessionID)
    expect(handoff).toEqual({
      agent: "atlas",
      context: "Fix the auth bug based on council findings",
    })

    expect(getSessionAgent(sessionID)).toBe("atlas")
  })

  //#given valid prometheus handoff args
  //#when execute is called
  //#then it stores pending handoff for prometheus
  test("should queue handoff to prometheus", async () => {
    const tool = createSessionHandoffTool()
    const result = await tool.execute(
      { agent: "Prometheus", context: "Create a plan for the refactoring" },
      toolContext
    )

    expect(result).toContain("prometheus")
    expect(result).toContain("Handoff queued")

    const handoff = consumePendingHandoff(sessionID)
    expect(handoff?.agent).toBe("prometheus")
  })

  //#given an invalid agent name
  //#when execute is called
  //#then it returns an error
  test("should reject invalid agent names", async () => {
    const tool = createSessionHandoffTool()
    const result = await tool.execute(
      { agent: "librarian", context: "Some context" },
      toolContext
    )

    expect(result).toContain("Invalid handoff target")
    expect(result).toContain("librarian")
    expect(consumePendingHandoff(sessionID)).toBeUndefined()
  })

  //#given agent name with different casing
  //#when execute is called
  //#then it normalizes to lowercase
  test("should handle case-insensitive agent names", async () => {
    const tool = createSessionHandoffTool()
    await tool.execute(
      { agent: "ATLAS", context: "Fix things" },
      toolContext
    )

    const handoff = consumePendingHandoff(sessionID)
    expect(handoff?.agent).toBe("atlas")
    expect(getSessionAgent(sessionID)).toBe("atlas")
  })
})
