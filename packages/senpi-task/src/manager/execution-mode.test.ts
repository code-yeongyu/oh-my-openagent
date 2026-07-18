import { describe, expect, test } from "bun:test"

import { resolveExecutionMode } from "./execution-mode"

describe("resolveExecutionMode", () => {
  test("#given a spec mode #when resolved #then the spec mode wins over every other source", () => {
    // given
    const sources = { specMode: "process" as const, agentMode: "in-process" as const, configMode: "in-process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given no spec mode but an agent mode #when resolved #then the agent mode wins over config", () => {
    // given
    const sources = { agentMode: "process" as const, configMode: "in-process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given only a config mode #when resolved #then the config mode is used", () => {
    // given
    const sources = { configMode: "process" as const }

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("process")
  })

  test("#given no source at all #when resolved #then it falls back to in-process", () => {
    // given
    const sources = {}

    // when
    const mode = resolveExecutionMode(sources)

    // then
    expect(mode).toBe("in-process")
  })
})
