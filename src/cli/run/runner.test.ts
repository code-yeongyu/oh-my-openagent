/// <reference types="bun-types" />

import { describe, it, expect, spyOn, afterEach } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import { resolveRunAgent, waitForEventProcessorShutdown } from "./runner"

const createConfig = (overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig => ({
  ...overrides,
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
    const timeoutMs = 50
    const start = performance.now()

    try {
      //#when
      await waitForEventProcessorShutdown(eventProcessor, timeoutMs)

      //#then
      const elapsed = performance.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs)
      const callArgs = spy.mock.calls.flat().join("")
      expect(callArgs).toContain(
        `[run] Event stream did not close within ${timeoutMs}ms after abort; continuing shutdown.`,
      )
    } finally {
      spy.mockRestore()
    }
  })
})
