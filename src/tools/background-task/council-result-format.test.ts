import { describe, expect, it } from "bun:test"
import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient } from "./clients"
import { formatCouncilTaskResult, isCouncilTask } from "./council-result-format"

function createMockClient(
  messages: Array<{ role: string; parts: Array<{ type: string; text: string }> }>,
): BackgroundOutputClient {
  return {
    session: {
      messages: async () =>
        messages.map((m, i) => ({
          id: `msg_${i}`,
          info: { role: m.role, time: new Date(Date.now() + i * 1000).toISOString() },
          parts: m.parts,
        })),
    },
  }
}

function createMockTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "test-task",
    parentSessionID: "parent-session",
    parentMessageID: "parent-message",
    description: "Test task",
    prompt: "test prompt",
    agent: "Council: Test",
    status: "completed",
    sessionID: "test-session",
    ...overrides,
  } as BackgroundTask
}

describe("formatCouncilTaskResult", () => {
  describe("#given a message with complete COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns has_response true and response_complete true", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [{ type: "text", text: "<COUNCIL_MEMBER_RESPONSE>analysis here</COUNCIL_MEMBER_RESPONSE>" }],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "analysis here",
        session_id: "test-session",
      })
    })
  })

  describe("#given a message with incomplete tags (no closing tag)", () => {
    it("#then returns has_response true and response_complete false", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [{ type: "text", text: "<COUNCIL_MEMBER_RESPONSE>partial analysis" }],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: true,
        response_complete: false,
        result: "partial analysis",
        session_id: "test-session",
      })
    })
  })

  describe("#given a message with no COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns has_response false and null result", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [{ type: "text", text: "Just some plain text without any tags." }],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
        session_id: "test-session",
      })
    })
  })

  describe("#given multiple complete COUNCIL_MEMBER_RESPONSE blocks", () => {
    it("#then returns content from the last complete block", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "<COUNCIL_MEMBER_RESPONSE>first analysis</COUNCIL_MEMBER_RESPONSE>\nSome interim text\n<COUNCIL_MEMBER_RESPONSE>final analysis</COUNCIL_MEMBER_RESPONSE>",
            },
          ],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "final analysis",
        session_id: "test-session",
      })
    })
  })

  describe("#given empty content inside COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns has_response true with empty string result", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [{ type: "text", text: "<COUNCIL_MEMBER_RESPONSE></COUNCIL_MEMBER_RESPONSE>" }],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "",
        session_id: "test-session",
      })
    })
  })

  describe("#given a task with no sessionID", () => {
    it("#then returns has_response false and null session_id", async () => {
      const client = createMockClient([])
      const task = createMockTask({ sessionID: undefined })
      const result = await formatCouncilTaskResult(task, client)

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
        session_id: null,
      })
    })
  })

  describe("#given exploration text before COUNCIL_MEMBER_RESPONSE tags", () => {
    it("#then returns only the tagged content", async () => {
      const client = createMockClient([
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Let me explore the codebase first..." },
            { type: "text", text: "Found some interesting patterns." },
          ],
        },
        {
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "After analysis:\n<COUNCIL_MEMBER_RESPONSE>the actual council response</COUNCIL_MEMBER_RESPONSE>",
            },
          ],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: true,
        response_complete: true,
        result: "the actual council response",
        session_id: "test-session",
      })
    })
  })

  describe("#given no assistant messages (only user messages)", () => {
    it("#then returns has_response false", async () => {
      const client = createMockClient([
        {
          role: "user",
          parts: [{ type: "text", text: "<COUNCIL_MEMBER_RESPONSE>user text</COUNCIL_MEMBER_RESPONSE>" }],
        },
      ])
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
        session_id: "test-session",
      })
    })
  })

  describe("#given an error response from the session client", () => {
    it("#then returns has_response false with session_id", async () => {
      const client: BackgroundOutputClient = {
        session: {
          messages: async () => ({ data: undefined, error: "Session not found" }),
        },
      }
      const result = await formatCouncilTaskResult(createMockTask(), client)

      expect(result).toEqual({
        has_response: false,
        response_complete: false,
        result: null,
        session_id: "test-session",
      })
    })
  })
})

describe("isCouncilTask", () => {
  describe("#given a task with agent starting with 'Council: '", () => {
    it("#then returns true for 'Council: Opus'", () => {
      expect(isCouncilTask(createMockTask({ agent: "Council: Opus" }))).toBe(true)
    })

    it("#then returns true for 'Council: Gemini'", () => {
      expect(isCouncilTask(createMockTask({ agent: "Council: Gemini" }))).toBe(true)
    })
  })

  describe("#given a task with a non-council agent", () => {
    it("#then returns false for 'explore'", () => {
      expect(isCouncilTask(createMockTask({ agent: "explore" }))).toBe(false)
    })
  })

  describe("#given a task with undefined agent", () => {
    it("#then returns false", () => {
      expect(isCouncilTask(createMockTask({ agent: undefined as unknown as string }))).toBe(false)
    })
  })

  describe("#given a task with lowercase 'council'", () => {
    it("#then returns false (prefix is case-sensitive)", () => {
      expect(isCouncilTask(createMockTask({ agent: "council" }))).toBe(false)
    })
  })
})
