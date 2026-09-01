/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../../config"
import { resolveRunAgent } from "./agent-resolver"

const createConfig = (overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig =>
  OhMyOpenCodeConfigSchema.parse(overrides)

describe("resolveRunAgent", () => {
  let consoleLogSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

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

  it("maps display-name style default_run_agent values to canonical prompt agent ids", () => {
    // given
    const config = createConfig({ default_run_agent: "Sisyphus - Ultraworker" })

    // when
    const agent = resolveRunAgent({ message: "test" }, config, {})

    // then
    expect(agent).toBe("sisyphus")
  })

  it("#given unknown custom agent #when resolving run agent #then leaves the custom prompt agent untouched", () => {
    // given
    const config = createConfig()

    // when
    const agent = resolveRunAgent({ message: "test", agent: "custom-agent" }, config, {})

    // then
    expect(agent).toBe("custom-agent")
  })
})

describe("waitForEventProcessorShutdown", () => {
  it("returns quickly when event processor completes", async () => {
    //#given
    const { waitForEventProcessorShutdown } = await import("./runner")
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
    const { waitForEventProcessorShutdown } = await import("./runner")
    const eventProcessor = new Promise<void>(() => {})
    const timeoutMs = 200
    const start = performance.now()

    //#when
    await waitForEventProcessorShutdown(eventProcessor, timeoutMs)

    //#then
    const elapsed = performance.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50)
  })
})

describe("run environment setup", () => {
  let originalClient: string | undefined
  let originalRunMode: string | undefined
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalClient = process.env.OPENCODE_CLIENT
    originalRunMode = process.env.OPENCODE_CLI_RUN_MODE
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalClient === undefined) {
      delete process.env.OPENCODE_CLIENT
    } else {
      process.env.OPENCODE_CLIENT = originalClient
    }
    if (originalRunMode === undefined) {
      delete process.env.OPENCODE_CLI_RUN_MODE
    } else {
      process.env.OPENCODE_CLI_RUN_MODE = originalRunMode
    }
    consoleErrorSpy.mockRestore()
  })

  it("sets OPENCODE_CLIENT to 'run' to exclude question tool from registry", async () => {
    //#given
    delete process.env.OPENCODE_CLIENT

    //#when
    const { run } = await import("./runner")
    await run({ message: "test", model: "invalid" })

    //#then
    expect(String(process.env.OPENCODE_CLIENT)).toBe("run")
    expect(String(process.env.OPENCODE_CLI_RUN_MODE)).toBe("true")
  })
})

describe("run with invalid model", () => {
  it("given invalid --model value, when run, then returns exit code 1 with error message", async () => {
    // given
    mock.restore()
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: unknown[]) => {
      errorMessages.push(args.map(String).join(" "))
    }

    try {
      // when
      const { run } = await import(`./runner?invalid-model=${Date.now()}-${Math.random()}`)
      const exitCode = await run({
        message: "test",
        model: "invalid",
      })

      // then
      expect(exitCode).toBe(1)
      expect(errorMessages.join("\n")).toContain("Model string must be in 'provider/model' format")
    } finally {
      console.error = originalError
    }
  })
})
