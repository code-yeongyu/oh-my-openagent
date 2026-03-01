import { describe, expect, it } from "bun:test"
import { COUNCIL_MEMBER_PROMPT, createCouncilMemberAgent } from "./council-member-agent"

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

      it("#then has tool restrictions with permission object", () => {
        expect(agent.permission).toBeDefined()
      })

      it("#then allows read tool", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.read).toBe("allow")
      })

      it("#then allows grep tool", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.grep).toBe("allow")
      })

      it("#then allows glob tool", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.glob).toBe("allow")
      })

      it("#then allows lsp_goto_definition tool", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.lsp_goto_definition).toBe("allow")
      })

      it("#then allows ast_grep_search tool", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.ast_grep_search).toBe("allow")
      })

      it("#then denies all other tools via wildcard", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm["*"]).toBe("deny")
      })

      it("#then explicitly denies todowrite", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.todowrite).toBe("deny")
      })

      it("#then explicitly denies todoread", () => {
        const perm = agent.permission as Record<string, string>
        expect(perm.todoread).toBe("deny")
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
