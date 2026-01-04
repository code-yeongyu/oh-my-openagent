import { describe, it, expect, beforeEach } from "bun:test"
import { ContextCollector } from "./collector"
import { injectPendingContext, createContextInjectorHook } from "./injector"

describe("injectPendingContext", () => {
  let collector: ContextCollector

  beforeEach(() => {
    collector = new ContextCollector()
  })

  describe("when parts have text content", () => {
    it("prepends context to first text part", () => {
      // #given
      const sessionID = "ses_inject1"
      collector.register(sessionID, {
        id: "ulw",
        source: "keyword-detector",
        content: "Ultrawork mode activated",
      })
      const parts = [{ type: "text", text: "User message" }]

      // #when
      const result = injectPendingContext(collector, sessionID, parts)

      // #then
      expect(result.injected).toBe(true)
      expect(parts[0].text).toContain("Ultrawork mode activated")
      expect(parts[0].text).toContain("User message")
    })

    it("uses separator between context and original message", () => {
      // #given
      const sessionID = "ses_inject2"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "Context content",
      })
      const parts = [{ type: "text", text: "Original message" }]

      // #when
      injectPendingContext(collector, sessionID, parts)

      // #then
      expect(parts[0].text).toBe("Context content\n\n---\n\nOriginal message")
    })

    it("consumes context after injection", () => {
      // #given
      const sessionID = "ses_inject3"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "Context",
      })
      const parts = [{ type: "text", text: "Message" }]

      // #when
      injectPendingContext(collector, sessionID, parts)

      // #then
      expect(collector.hasPending(sessionID)).toBe(false)
    })

    it("returns injected=false when no pending context", () => {
      // #given
      const sessionID = "ses_empty"
      const parts = [{ type: "text", text: "Message" }]

      // #when
      const result = injectPendingContext(collector, sessionID, parts)

      // #then
      expect(result.injected).toBe(false)
      expect(parts[0].text).toBe("Message")
    })
  })

  describe("when parts have no text content", () => {
    it("does not inject and preserves context", () => {
      // #given
      const sessionID = "ses_notext"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "Context",
      })
      const parts = [{ type: "image", url: "https://example.com/img.png" }]

      // #when
      const result = injectPendingContext(collector, sessionID, parts)

      // #then
      expect(result.injected).toBe(false)
      expect(collector.hasPending(sessionID)).toBe(true)
    })
  })

  describe("with multiple text parts", () => {
    it("injects into first text part only", () => {
      // #given
      const sessionID = "ses_multi"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "Context",
      })
      const parts = [
        { type: "text", text: "First" },
        { type: "text", text: "Second" },
      ]

      // #when
      injectPendingContext(collector, sessionID, parts)

      // #then
      expect(parts[0].text).toContain("Context")
      expect(parts[1].text).toBe("Second")
    })
  })
})

describe("createContextInjectorHook", () => {
  let collector: ContextCollector

  beforeEach(() => {
    collector = new ContextCollector()
  })

  describe("chat.message handler", () => {
    it("injects pending context into output parts", async () => {
      // #given
      const hook = createContextInjectorHook(collector)
      const sessionID = "ses_hook1"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "Hook context",
      })
      const input = { sessionID }
      const output = {
        message: {},
        parts: [{ type: "text", text: "User message" }],
      }

      // #when
      await hook["chat.message"](input, output)

      // #then
      expect(output.parts[0].text).toContain("Hook context")
      expect(output.parts[0].text).toContain("User message")
    })

    it("does nothing when no pending context", async () => {
      // #given
      const hook = createContextInjectorHook(collector)
      const sessionID = "ses_hook2"
      const input = { sessionID }
      const output = {
        message: {},
        parts: [{ type: "text", text: "User message" }],
      }

      // #when
      await hook["chat.message"](input, output)

      // #then
      expect(output.parts[0].text).toBe("User message")
    })
  })
})
