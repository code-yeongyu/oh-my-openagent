import { describe, expect, it } from "bun:test"
import { createPhaseRulesInjectorHook } from "./index"

describe("createPhaseRulesInjectorHook", () => {
  //#given a hook factory
  it("should return a hook with chat.message handler", () => {
    //#when creating the hook
    const hook = createPhaseRulesInjectorHook()

    //#then it should have the chat.message handler
    expect(hook).toBeDefined()
    expect(hook["chat.message"]).toBeDefined()
    expect(typeof hook["chat.message"]).toBe("function")
  })

  describe("chat.message handler", () => {
    //#given a planning context prompt
    it("should detect planning phase and inject planning rules", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Let's plan the architecture for this feature" }]
      }

      //#when handling a planning prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject planning rules
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("planning")
      expect(injectedText).toContain("architecture")
    })

    //#given an implementation context prompt
    it("should detect implementation phase and inject implementation rules", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Implement the user authentication module" }]
      }

      //#when handling an implementation prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject implementation rules
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("implementation")
      expect(injectedText).toContain("TDD")
    })

    //#given a review context prompt
    it("should detect review phase and inject review rules", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Review this code for security issues" }]
      }

      //#when handling a review prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject review rules
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("review")
      expect(injectedText).toContain("security")
    })

    //#given a prompt with check keyword
    it("should detect review phase from 'check' keyword", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Check if there are any performance bottlenecks" }]
      }

      //#when handling a check prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject review rules
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("review")
    })

    //#given a prompt with build keyword
    it("should detect implementation phase from 'build' keyword", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Build a new dashboard component" }]
      }

      //#when handling a build prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject implementation rules
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("implementation")
    })

    //#given an ambiguous prompt
    it("should default to planning phase for ambiguous prompts", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: [{ type: "text", text: "Help me with this feature" }]
      }

      //#when handling an ambiguous prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should inject planning rules as default
      const injectedText = output.parts.find(p => p.text?.includes("[PHASE-AWARE RULES]"))?.text
      expect(injectedText).toBeDefined()
      expect(injectedText).toContain("planning")
    })

    //#given an empty prompt
    it("should not inject rules for empty prompts", async () => {
      const hook = createPhaseRulesInjectorHook()
      const output: { parts: Array<{ type: string; text?: string }> } = {
        parts: []
      }

      //#when handling an empty prompt
      await hook["chat.message"]!(
        { sessionID: "test-session" },
        output
      )

      //#then it should not inject any rules
      expect(output.parts.length).toBe(0)
    })
  })
})
