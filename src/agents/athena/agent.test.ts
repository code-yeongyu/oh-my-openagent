/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createAthenaAgent } from "./agent"

describe("createAthenaAgent", () => {
  const originalEnv = process.env.OPENCODE_CLI_RUN_MODE

  beforeEach(() => {
    delete process.env.OPENCODE_CLI_RUN_MODE
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENCODE_CLI_RUN_MODE = originalEnv
    } else {
      delete process.env.OPENCODE_CLI_RUN_MODE
    }
  })

  describe("#given the agent mode", () => {
    describe("#when accessing the static mode property", () => {
      it("#then equals 'all' to support both primary and subagent contexts", () => {
        expect(createAthenaAgent.mode).toBe("all")
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

      it("#then includes a description", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.description).toContain("synthesis strategist")
      })
    })
  })

  describe("#given default invocation (no CLI mode)", () => {
    describe("#when OPENCODE_CLI_RUN_MODE is not set", () => {
      it("#then selects the interactive prompt", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("Question tool")
      })

      it("#then contains interactive workflow sections", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("Step 2: Council setup (default flow before launch).")
        expect(config.prompt).toContain("<agent_handoff>")
      })

      it("#then does not contain non-interactive output contract", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("<athena_council_result>")
      })
    })
  })

  describe("#given CLI run mode", () => {
    describe("#when OPENCODE_CLI_RUN_MODE is 'true'", () => {
      beforeEach(() => {
        process.env.OPENCODE_CLI_RUN_MODE = "true"
      })

      it("#then selects the non-interactive prompt", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("<athena_council_result>")
      })

      it("#then contains non-interactive constraints", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("NEVER use the Question tool")
      })

      it("#then does not contain interactive agent handoff section", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).not.toContain("<agent_handoff>")
      })
    })

    describe("#when OPENCODE_CLI_RUN_MODE is 'false'", () => {
      beforeEach(() => {
        process.env.OPENCODE_CLI_RUN_MODE = "false"
      })

      it("#then selects the interactive prompt", () => {
        const config = createAthenaAgent("anthropic/claude-opus-4-6")
        expect(config.prompt).toContain("Question tool")
        expect(config.prompt).not.toContain("<athena_council_result>")
      })
    })
  })
})
