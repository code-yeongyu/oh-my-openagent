/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { AGENT_NAME_MAP, migrateAgentNames } from "./agent-names"

describe("AGENT_NAME_MAP parenthesized aliases", () => {
  test("maps Sisyphus (Ultraworker) to sisyphus", () => {
    // given
    const alias = "Sisyphus (Ultraworker)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("sisyphus")
  })

  test("maps Hephaestus (Deep Agent) to hephaestus", () => {
    // given
    const alias = "Hephaestus (Deep Agent)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("hephaestus")
  })

  test("maps Prometheus (Plan Builder) to prometheus", () => {
    // given
    const alias = "Prometheus (Plan Builder)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("prometheus")
  })

  test("maps Atlas (Plan Executor) to atlas", () => {
    // given
    const alias = "Atlas (Plan Executor)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("atlas")
  })

  test("maps Metis (Plan Consultant) to metis", () => {
    // given
    const alias = "Metis (Plan Consultant)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("metis")
  })

  test("maps Momus (Plan Critic) to momus", () => {
    // given
    const alias = "Momus (Plan Critic)"

    // when
    const result = AGENT_NAME_MAP[alias]

    // then
    expect(result).toBe("momus")
  })
})

describe("migrateAgentNames with parenthesized aliases", () => {
  test("migrates all parenthesized aliases to canonical names", () => {
    // given
    const legacyAgents = {
      "Sisyphus (Ultraworker)": { model: "claude-opus-4" },
      "Hephaestus (Deep Agent)": { model: "gpt-5.4" },
      "Prometheus (Plan Builder)": { model: "claude-opus-4" },
      "Atlas (Plan Executor)": { model: "kimi-k2.5" },
      "Metis (Plan Consultant)": { model: "claude-opus-4" },
      "Momus (Plan Critic)": { model: "claude-opus-4" },
    }

    // when
    const { migrated, changed } = migrateAgentNames(legacyAgents)

    // then
    expect(changed).toBe(true)
    expect(migrated.sisyphus).toEqual({ model: "claude-opus-4" })
    expect(migrated.hephaestus).toEqual({ model: "gpt-5.4" })
    expect(migrated.prometheus).toEqual({ model: "claude-opus-4" })
    expect(migrated.atlas).toEqual({ model: "kimi-k2.5" })
    expect(migrated.metis).toEqual({ model: "claude-opus-4" })
    expect(migrated.momus).toEqual({ model: "claude-opus-4" })
    expect(migrated["Sisyphus (Ultraworker)"]).toBeUndefined()
    expect(migrated["Hephaestus (Deep Agent)"]).toBeUndefined()
  })
})
