/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createAthenaAgent } from "./agent"
import { createAthenaJuniorAgent } from "./athena-junior-agent"

describe("createAthenaAgent", () => {
  describe("#given the agent mode", () => {
    describe("#when accessing the static mode property", () => {
      it("#then equals 'primary'", () => {
        expect(createAthenaAgent.mode).toBe("primary")
      })
    })
  })

  describe("#given the agent config", () => {
    describe("#when creating the agent with a model", () => {
      it("#then returns config with the specified model", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.model).toBe("anthropic/claude-opus-4-6")
      })

      it("#then sets temperature to 0.1", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.temperature).toBe(0.1)
      })

      it("#then includes tool restrictions denying call_omo_agent", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.permission).toBeDefined()
      })

      it("#then includes a description containing synthesis strategist", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.description).toContain("synthesis strategist")
      })
    })
  })

  describe("#given the interactive prompt", () => {
    describe("#when checking prompt content", () => {
      it("#then contains Question tool references", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("Question tool")
      })

      it("#then contains Step 2: Council setup section", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("Step 2: Council setup")
      })

      it("#then contains agent_handoff section", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("<agent_handoff>")
      })

      it("#then does not contain non-interactive output contract", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("<athena_council_result>")
      })

      it("#then does not contain NEVER use the Question tool constraint", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("NEVER use the Question tool")
      })
    })
  })
})

describe("createAthenaJuniorAgent", () => {
  describe("#given the agent mode", () => {
    describe("#when accessing the static mode property", () => {
      it("#then equals 'subagent'", () => {
        expect(createAthenaJuniorAgent.mode).toBe("subagent")
      })
    })
  })

  describe("#given the agent config", () => {
    describe("#when creating the agent with a model", () => {
      it("#then returns config with the specified model", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.model).toBe("anthropic/claude-opus-4-6")
      })

      it("#then sets temperature to 0.1", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.temperature).toBe(0.1)
      })

      it("#then includes tool restrictions denying call_omo_agent and question", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.permission).toBeDefined()
      })

      it("#then includes a description containing Non-interactive", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.description).toContain("Non-interactive")
      })
    })
  })

  describe("#given the non-interactive prompt", () => {
    describe("#when checking prompt content", () => {
      it("#then contains athena_council_result output contract", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("<athena_council_result>")
      })

      it("#then contains NEVER use the Question tool constraint", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("NEVER use the Question tool")
      })

      it("#then does not contain agent_handoff section", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("<agent_handoff>")
      })

      it("#then does not contain switch_agent references", () => {
        const config = createAthenaJuniorAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("switch_agent")
      })
    })
  })
})
