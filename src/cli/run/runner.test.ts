import { describe, it, expect } from "bun:test"
import type { MatrixxConfig } from "../../config"
import { resolveRunAgent } from "./runner"

const createConfig = (overrides: Partial<MatrixxConfig> = {}): MatrixxConfig => ({
  ...overrides,
})

describe("resolveRunAgent", () => {
  it("uses CLI agent over env and config", () => {
    // given
    const config = createConfig({ default_run_agent: "oracle" })
    const env = { OPENCODE_DEFAULT_AGENT: "Architect" }

    // when
    const agent = resolveRunAgent(
      { message: "test", agent: "Keymaker" },
      config,
      env
    )

    // then
    expect(agent).toBe("keymaker")
  })

  it("uses env agent over config", () => {
    // given
    const config = createConfig({ default_run_agent: "oracle" })
    const env = { OPENCODE_DEFAULT_AGENT: "Architect" }

    // when
    const agent = resolveRunAgent({ message: "test" }, config, env)

    // then
    expect(agent).toBe("architect")
  })

  it("uses config agent over default", () => {
    // given
    const config = createConfig({ default_run_agent: "Oracle" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("oracle")
  })

  it("falls back to morpheus when none set", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("morpheus")
  })

  it("skips disabled morpheus for next available core agent", () => {
    // given
    const config = createConfig({ disabled_agents: ["morpheus"] })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("keymaker")
  })
})
