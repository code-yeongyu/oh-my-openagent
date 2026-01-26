import { describe, it, expect, beforeEach } from "bun:test"
import { createAgentSkillReminderHook } from "./index"
import { AGENTS_WITH_DEFAULT_SKILLS } from "./constants"
import { _resetForTesting, subagentSessions } from "../../features/claude-code-session-state"
import type { ContextCollector } from "../../features/context-injector"

describe("agent-skill-reminder", () => {
  let registeredContexts: Array<{ sessionID: string; context: unknown }>

  function createMockCollector(): ContextCollector {
    return {
      sessions: new Map(),
      register: (sessionID: string, context: unknown) => {
        registeredContexts.push({ sessionID, context })
      },
      getPending: () => [],
      consume: () => [],
      clear: () => {},
      getBySource: () => [],
      removeBySource: () => {},
    } as unknown as ContextCollector
  }

  function createMockPluginInput() {
    return {
      directory: "/tmp/test",
    } as any
  }

  beforeEach(() => {
    _resetForTesting()
    registeredContexts = []
    subagentSessions.clear()
  })

  describe("chat.message handler", () => {
    describe("#given agent with default skills", () => {
      it("#then should inject skill reminder on first message", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-1"

        // #when
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello" }] }
        )

        // #then
        expect(registeredContexts.length).toBe(1)
        expect(registeredContexts[0].sessionID).toBe(sessionID)
      })

      it("#then should not inject reminder twice for same session", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-2"

        // #when - first message
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "First" }] }
        )

        // #when - second message
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Second" }] }
        )

        // #then - only one reminder
        expect(registeredContexts.length).toBe(1)
      })
    })

    describe("#given agent without default skills", () => {
      it("#then should not inject reminder", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-3"

        // #when
        await hook["chat.message"](
          { sessionID, agent: "oracle" },
          { message: {}, parts: [{ type: "text", text: "Hello" }] }
        )

        // #then
        expect(registeredContexts.length).toBe(0)
      })
    })

    describe("#given subagent session", () => {
      it("#then should skip reminder (delegate_task handles it)", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "subagent-session"
        subagentSessions.add(sessionID)

        // #when
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello" }] }
        )

        // #then
        expect(registeredContexts.length).toBe(0)
      })
    })

    describe("#given system directive message", () => {
      it("#then should skip reminder", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-4"

        // #when - message with system directive (uses correct format)
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]" }] }
        )

        // #then
        expect(registeredContexts.length).toBe(0)
      })
    })
  })

  describe("event handler", () => {
    describe("#given session.deleted event", () => {
      it("#then should cleanup session state", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-5"

        // First inject reminder
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello" }] }
        )
        expect(registeredContexts.length).toBe(1)

        // #when - session deleted
        await hook.event({
          event: { type: "session.deleted", properties: { info: { id: sessionID } } },
        })

        // #when - new message on same session ID (after cleanup)
        registeredContexts = []
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello again" }] }
        )

        // #then - reminder should be injected again
        expect(registeredContexts.length).toBe(1)
      })
    })

    describe("#given session.compacted event", () => {
      it("#then should cleanup session state", async () => {
        // #given
        const collector = createMockCollector()
        const hook = createAgentSkillReminderHook(createMockPluginInput(), collector)
        const sessionID = "test-session-6"

        // First inject reminder
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello" }] }
        )
        expect(registeredContexts.length).toBe(1)

        // #when - session compacted
        await hook.event({
          event: { type: "session.compacted", properties: { sessionID } },
        })

        // #when - new message on same session ID (after cleanup)
        registeredContexts = []
        await hook["chat.message"](
          { sessionID, agent: "Prometheus (Planner)" },
          { message: {}, parts: [{ type: "text", text: "Hello again" }] }
        )

        // #then - reminder should be injected again
        expect(registeredContexts.length).toBe(1)
      })
    })
  })

  describe("AGENTS_WITH_DEFAULT_SKILLS constant", () => {
    it("#then should include expected agents", () => {
      expect(AGENTS_WITH_DEFAULT_SKILLS).toContain("Prometheus (Planner)")
      expect(AGENTS_WITH_DEFAULT_SKILLS).toContain("Metis (Plan Consultant)")
      expect(AGENTS_WITH_DEFAULT_SKILLS).toContain("Momus (Plan Reviewer)")
      expect(AGENTS_WITH_DEFAULT_SKILLS).toContain("archiver")
      expect(AGENTS_WITH_DEFAULT_SKILLS).toContain("frontend-ui-ux-engineer")
    })
  })
})
