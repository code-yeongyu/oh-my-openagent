/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
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
    expect(agent).toBe("Hephaestus (Deep Agent)")
  })

  it("uses env agent over config", () => {
    // given
    const config = createConfig({ default_run_agent: "prometheus" })
    const env = { OPENCODE_DEFAULT_AGENT: "Atlas" }

    // when
    const agent = resolveRunAgent({ message: "test" }, config, env)

    // then
    expect(agent).toBe("Atlas (Plan Executor)")
  })

  it("uses config agent over default", () => {
    // given
    const config = createConfig({ default_run_agent: "Prometheus" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Prometheus (Plan Builder)")
  })

  it("falls back to sisyphus when none set", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Sisyphus (Ultraworker)")
  })

  it("skips disabled sisyphus for next available core agent", () => {
    // given
    const config = createConfig({ disabled_agents: ["sisyphus"] })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Hephaestus (Deep Agent)")
  })

  it("maps display-name style default_run_agent values to canonical display names", () => {
    // given
    const config = createConfig({ default_run_agent: "Sisyphus (Ultraworker)" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("Sisyphus (Ultraworker)")
  })
})

describe("waitForEventProcessorShutdown", () => {

  it("returns quickly when event processor completes", async () => {
    //#given
    const eventProcessor = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 25)
    })
    const start = performance.now()

    //#when
    await waitForEventProcessorShutdown(eventProcessor, 200)

    //#then
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  it("times out and continues when event processor does not complete", async () => {
    //#given
    const eventProcessor = new Promise<void>(() => {})
    const timeoutMs = 200
    const start = performance.now()

    //#when
    await waitForEventProcessorShutdown(eventProcessor, timeoutMs)

    //#then
    const elapsed = performance.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 10)
  })
})
