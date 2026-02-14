import { describe, it, expect, spyOn } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import { resolveRunAgent, waitForEventProcessorShutdown } from "./runner"

const createConfig = (overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig => ({
  ...overrides,
})

describe("waitForEventProcessorShutdown", () => {
  it("returns quickly when event processor completes", async () => {
    // given
    const eventProcessor = Promise.resolve()

    // when
    const start = Date.now()
    await waitForEventProcessorShutdown(eventProcessor, 50)
    const elapsed = Date.now() - start

    // then
    expect(elapsed).toBeLessThan(50)
  })

  it("times out and continues when event processor does not complete", async () => {
    // given
    const never = new Promise<void>(() => {})
    const logSpy = spyOn(console, "log").mockImplementation(() => {})

    // when
    const start = Date.now()
    await waitForEventProcessorShutdown(never, 25)
    const elapsed = Date.now() - start

    // then
    expect(elapsed).toBeGreaterThanOrEqual(20)
    expect(logSpy).toHaveBeenCalled()

    // cleanup
    logSpy.mockRestore()
})

describe("resolveRunAgent", () => {
  it("uses CLI agent over env and config", () => {
    // given
    const config = createConfig({ default_run_agent: "prometheus" })
    const env = { OPENCODE_DEFAULT_AGENT: "Atlas" }

    // when
    const agent = resolveRunAgent(
      { message: "test", agent: "Hephaestus" },
      config,
      env
    )

    // then
    expect(agent).toBe("hephaestus")
  })

  it("uses env agent over config", () => {
    // given
    const config = createConfig({ default_run_agent: "prometheus" })
    const env = { OPENCODE_DEFAULT_AGENT: "Atlas" }

    // when
    const agent = resolveRunAgent({ message: "test" }, config, env)

    // then
    expect(agent).toBe("atlas")
  })

  it("uses config agent over default", () => {
    // given
    const config = createConfig({ default_run_agent: "Prometheus" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("prometheus")
  })

  it("falls back to sisyphus when none set", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("sisyphus")
  })

  it("skips disabled sisyphus for next available core agent", () => {
    // given
    const config = createConfig({ disabled_agents: ["sisyphus"] })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("hephaestus")
  })
})
