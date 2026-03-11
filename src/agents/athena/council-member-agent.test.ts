import { describe, expect, it } from "bun:test"
import { COUNCIL_MEMBER_PROMPT, COUNCIL_SOLO_ADDENDUM, createCouncilMemberAgent } from "./council-member-agent"

describe("COUNCIL_MEMBER_PROMPT", () => {
  describe("#given the prompt constant", () => {
    describe("#when checking for required tag instructions", () => {
      it("#then contains COUNCIL_MEMBER_RESPONSE tag name", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("COUNCIL_MEMBER_RESPONSE")
      })

      it("#then contains Response Format section header", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("Response Format")
      })

      it("#then contains opening tag example", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("<COUNCIL_MEMBER_RESPONSE>")
      })

      it("#then contains closing tag example", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("</COUNCIL_MEMBER_RESPONSE>")
      })
    })

    describe("#when checking for audit bias regression", () => {
      it("#then does not contain severity (moved to AUDIT addendum)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("severity")
      })

      it("#then does not contain Search the codebase (codebase-specific)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("Search the codebase")
      })

      it("#then does not contain Focus on finding real issues (AUDIT-specific)", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toContain("Focus on finding real issues")
      })

      it("#then does not contain AUDIT-style numbered finding headers", () => {
        expect(COUNCIL_MEMBER_PROMPT).not.toMatch(/## Finding \d/)
      })

      it("#then contains evidence-based (generic analysis language)", () => {
        expect(COUNCIL_MEMBER_PROMPT).toContain("evidence-based")
      })
    })
  })
})

describe("COUNCIL_SOLO_ADDENDUM", () => {
  describe("#given the solo mode addendum", () => {
    describe("#when checking for prohibition language", () => {
      it("#then contains call_omo_agent (prohibition)", () => {
        expect(COUNCIL_SOLO_ADDENDUM).toContain("call_omo_agent")
      })

      it("#then contains Do NOT (prohibition language)", () => {
        expect(COUNCIL_SOLO_ADDENDUM).toContain("Do NOT")
      })

      it("#then contains ALL exploration yourself (self-reliance instruction)", () => {
        expect(COUNCIL_SOLO_ADDENDUM).toContain("ALL exploration yourself")
      })
    })
  })
})

describe("createCouncilMemberAgent", () => {
  describe("#given a model string", () => {
    describe("#when creating a council member agent", () => {
      const agent = createCouncilMemberAgent("openai/gpt-5-nano")

      it("#then returns an object with the given model", () => {
        expect(agent.model).toBe("openai/gpt-5-nano")
      })

      it("#then has temperature 0.1", () => {
        expect(agent.temperature).toBe(0.1)
      })

      it("#then has the COUNCIL_MEMBER_PROMPT as prompt", () => {
        expect(agent.prompt).toBe(COUNCIL_MEMBER_PROMPT)
      })

      it("#then has mode subagent", () => {
        expect(agent.mode).toBe("subagent")
      })

      it("#then has runtime tool restrictions", () => {
        expect(agent.tools).toBeDefined()
      })

      it("#then allows read tool in delegation mode", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.read).toBe(true)
      })

      it("#then allows grep tool in delegation mode", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.grep).toBe(true)
      })

      it("#then allows glob tool in delegation mode", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.glob).toBe(true)
      })

      it("#then allows lsp_goto_definition tool in delegation mode", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.lsp_goto_definition).toBe(true)
      })

      it("#then allows ast_grep_search tool in delegation mode", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.ast_grep_search).toBe(true)
      })

      it("#then denies all other tools via wildcard", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools["*"]).toBe(false)
      })

      it("#then explicitly denies todowrite", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.todowrite).toBe(false)
      })

      it("#then explicitly denies todoread", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.todoread).toBe(false)
      })

      it("#then allows delegation tools by default", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.call_omo_agent).toBe(true)
        expect(tools.background_output).toBe(true)
        expect(tools.background_wait).toBe(true)
        expect(tools.background_cancel).toBe(true)
      })
    })

    describe("#when creating a solo-mode council member agent", () => {
      const agent = createCouncilMemberAgent("openai/gpt-5-nano", "solo")

      it("#then only allows finish_task and background_wait", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools["*"]).toBe(false)
        expect(tools.finish_task).toBe(true)
        expect(tools.background_wait).toBe(true)
      })

      it("#then denies direct exploration and delegation tools at runtime", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.read).toBe(false)
        expect(tools.grep).toBe(false)
        expect(tools.glob).toBe(false)
        expect(tools.ast_grep_search).toBe(false)
        expect(tools.call_omo_agent).toBe(false)
        expect(tools.background_output).toBe(false)
        expect(tools.background_cancel).toBe(false)
      })
    })

    describe("#when creating a delegation-mode council member agent", () => {
      const agent = createCouncilMemberAgent("openai/gpt-5-nano", "delegation")

      it("#then allows delegation-specific runtime tools", () => {
        const tools = agent.tools as Record<string, boolean>
        expect(tools.call_omo_agent).toBe(true)
        expect(tools.background_output).toBe(true)
        expect(tools.background_wait).toBe(true)
        expect(tools.background_cancel).toBe(true)
      })
    })
  })

  describe("#given the factory function", () => {
    describe("#when checking the static mode property", () => {
      it("#then has mode 'subagent'", () => {
        expect(createCouncilMemberAgent.mode).toBe("subagent")
      })
    })
  })
})
