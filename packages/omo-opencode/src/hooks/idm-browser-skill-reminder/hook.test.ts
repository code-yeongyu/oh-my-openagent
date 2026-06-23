import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createIdmBrowserSkillReminderHook } from "./hook"

type Output = { title: string; output: string; metadata: unknown }

function makeOutput(): Output {
  return { title: "", output: "previous-content", metadata: null }
}

const ORIGINAL_ENV = process.env.IDM_BROWSER_SKILL_REMINDER

describe("idm-browser-skill-reminder", () => {
  beforeEach(() => {
    delete process.env.IDM_BROWSER_SKILL_REMINDER
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.IDM_BROWSER_SKILL_REMINDER
    } else {
      process.env.IDM_BROWSER_SKILL_REMINDER = ORIGINAL_ENV
    }
  })

  describe("#given first idm_browser_browser_* call in a session", () => {
    test("#then output gets reminder appended once", async () => {
      const hook = createIdmBrowserSkillReminderHook()
      const out = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "s1", callID: "c1" },
        out,
      )
      expect(out.output).toContain("idm-browser-playbook")
      expect(out.output).toContain("previous-content")
    })

    test("#then second call in the same session does NOT re-fire", async () => {
      const hook = createIdmBrowserSkillReminderHook()
      const out1 = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "s1", callID: "c1" },
        out1,
      )

      const out2 = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_navigate", sessionID: "s1", callID: "c2" },
        out2,
      )
      expect(out2.output).toBe("previous-content")
    })
  })

  describe("#given non-browser tool", () => {
    test("#then no reminder appended", async () => {
      const hook = createIdmBrowserSkillReminderHook()
      const out = makeOutput()
      await hook["tool.execute.after"](
        { tool: "bash", sessionID: "s1", callID: "c1" },
        out,
      )
      expect(out.output).toBe("previous-content")
    })
  })

  describe("#given IDM_BROWSER_SKILL_REMINDER=false", () => {
    test("#then no reminder appended even on first browser call", async () => {
      process.env.IDM_BROWSER_SKILL_REMINDER = "false"
      const hook = createIdmBrowserSkillReminderHook()
      const out = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "s1", callID: "c1" },
        out,
      )
      expect(out.output).toBe("previous-content")
    })
  })

  describe("#given session.deleted event", () => {
    test("#then state is cleared and a new browser call re-fires the reminder", async () => {
      const hook = createIdmBrowserSkillReminderHook()
      const out1 = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "s1", callID: "c1" },
        out1,
      )
      await hook.event({ event: { type: "session.deleted", properties: { info: { id: "s1" } } } })

      const out2 = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "s1", callID: "c2" },
        out2,
      )
      expect(out2.output).toContain("idm-browser-playbook")
    })
  })

  describe("#given different sessions", () => {
    test("#then each session fires its own reminder once", async () => {
      const hook = createIdmBrowserSkillReminderHook()

      const a = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "session-a", callID: "c1" },
        a,
      )
      const b = makeOutput()
      await hook["tool.execute.after"](
        { tool: "idm_browser_browser_click", sessionID: "session-b", callID: "c1" },
        b,
      )

      expect(a.output).toContain("idm-browser-playbook")
      expect(b.output).toContain("idm-browser-playbook")
    })
  })
})
