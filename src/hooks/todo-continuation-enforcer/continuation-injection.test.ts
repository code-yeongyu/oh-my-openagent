declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { injectContinuation, formatTodoList } from "./continuation-injection"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

describe("injectContinuation", () => {
  test("inherits tools from resolved message info when reinjecting", async () => {
    // given
    let capturedTools: Record<string, boolean> | undefined
    let capturedText: string | undefined
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          promptAsync: async (input: {
            body: {
              tools?: Record<string, boolean>
              parts?: Array<{ type: string; text: string }>
            }
          }) => {
            capturedTools = input.body.tools
            capturedText = input.body.parts?.[0]?.text
            return {}
          },
        },
      },
    }
    const sessionStateStore = {
      getExistingState: () => ({ inFlight: false, lastInjectedAt: 0, consecutiveFailures: 0 }),
    }

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID: "ses_continuation_tools",
      resolvedInfo: {
        agent: "Hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        tools: { question: "deny", bash: "allow" },
      },
      sessionStateStore: sessionStateStore as never,
    })

    // then
    expect(capturedTools).toEqual({ question: false, bash: true })
    expect(capturedText).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })
})

describe("formatTodoList", () => {
  describe("#given compression disabled", () => {
    test("returns JSON stringified array when compression disabled", () => {
      // given
      const todos = [
        { id: "1", content: "Task one", status: "pending", priority: "high" },
        { id: "2", content: "Task two", status: "in_progress", priority: "medium" },
      ]
      const config = { enabled: false, threshold: 5000 }

      // when
      const result = formatTodoList(todos as never, config)

      // then
      expect(result).toBe('[{"status":"pending","content":"Task one"},{"status":"in_progress","content":"Task two"}]')
    })
  })

  describe("#given compression enabled but below threshold", () => {
    test("returns JSON stringified array when below threshold", () => {
      // given
      const todos = [
        { id: "1", content: "Short", status: "pending", priority: "high" },
      ]
      const config = { enabled: true, threshold: 5000 }

      // when
      const result = formatTodoList(todos as never, config)

      // then
      expect(result).toBe('[{"status":"pending","content":"Short"}]')
    })
  })

  describe("#given compression enabled with large data", () => {
    test("compresses large todo array when enabled and above threshold", () => {
      // given
      const todos = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        content: `Task ${i} with a longer description to increase size`,
        status: "pending",
        priority: "high",
      }))
      const config = { enabled: true, threshold: 100 }

      // when
      const result = formatTodoList(todos as never, config)

      // then
      // When compression is applied, the result should be different from plain JSON
      // and should contain the toon format marker
      expect(result.length).toBeGreaterThan(0)
      expect(result).not.toBe(JSON.stringify(todos.map(t => ({ status: t.status, content: t.content }))))
    })
  })

  describe("#given empty todos", () => {
    test("returns empty array string", () => {
      // given
      const todos: never[] = []
      const config = { enabled: true, threshold: 5000 }

      // when
      const result = formatTodoList(todos, config)

      // then
      expect(result).toBe("[]")
    })
  })
})
