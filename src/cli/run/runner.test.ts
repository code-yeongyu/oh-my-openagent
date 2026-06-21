/// <reference types="bun-types" />

import { afterEach, describe, expect, it, spyOn } from "bun:test"
import type { MatrixxConfig } from "../../config"
import { resolveRunAgent, waitForEventProcessorShutdown } from "./runner"

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
    expect(agent).toBe("Keymaker (Deep Agent)")
  })

  it("uses env agent over config", () => {
    // given
    const config = createConfig({ default_run_agent: "oracle" })
    const env = { OPENCODE_DEFAULT_AGENT: "Architect" }

    // when
    const agent = resolveRunAgent({ message: "test" }, config, env)

    // then
    expect(agent).toBe("Architect (Plan Execution Orchestrator)")
  })

  it("uses config agent over default", () => {
    // given
    const config = createConfig({ default_run_agent: "Oracle" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Oracle (Plan Builder)")
  })

  it("falls back to morpheus when none set", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Morpheus (Ultraworker)")
  })

  it("skips disabled morpheus for next available core agent", () => {
    // given
    const config = createConfig({ disabled_agents: ["morpheus"] })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Keymaker (Deep Agent)")
  })

  it("maps display-name style default_run_agent values to canonical display names", () => {
    // given
    const config = createConfig({ default_run_agent: "Morpheus" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Morpheus (Ultraworker)")
  })
})

describe("waitForEventProcessorShutdown", () => {
  let consoleLogSpy: ReturnType<typeof spyOn<typeof console, "log">> | null = null

  afterEach(() => {
    if (consoleLogSpy) {
      consoleLogSpy.mockRestore()
      consoleLogSpy = null
    }
  })

  it("returns quickly when event processor completes", async () => {
    //#given
    const eventProcessor = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 25)
    })
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
    const start = performance.now()

    //#when
    await waitForEventProcessorShutdown(eventProcessor, 200)

    //#then
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
    expect(console.log).not.toHaveBeenCalledWith(
      "[run] Event stream did not close within 200ms after abort; continuing shutdown.",
    )
  })

  it("times out and continues when event processor does not complete", async () => {
    //#given
    const eventProcessor = new Promise<void>(() => {})
    const spy = spyOn(console, "log").mockImplementation(() => {})
    consoleLogSpy = spy
    const timeoutMs = 200
    const start = performance.now()

    try {
      //#when
      await waitForEventProcessorShutdown(eventProcessor, timeoutMs)

      //#then
      const elapsed = performance.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 10)
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1)
    } finally {
      spy.mockRestore()
    }
  })
})
