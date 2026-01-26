import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { applyAgentVariant, resolveAgentVariant } from "./agent-variant"

describe("resolveAgentVariant", () => {
  test("returns undefined when agent name missing", () => {
    // #given
    const config = {} as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config)

    // #then
    expect(variant).toBeUndefined()
  })

  test("returns agent override variant", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config, "sisyphus")

    // #then
    expect(variant).toBe("low")
  })

  test("returns category variant when agent uses category", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { category: "ultrabrain" },
      },
      categories: {
        ultrabrain: { model: "openai/gpt-5.2", variant: "xhigh" },
      },
    } as OhMyOpenCodeConfig

    // #when
    const variant = resolveAgentVariant(config, "sisyphus")

    // #then
    expect(variant).toBe("xhigh")
  })
})

describe("applyAgentVariant", () => {
  test("sets variant when message is undefined", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message: { variant?: string } = {}

    // #when
    applyAgentVariant(config, "sisyphus", message)

    // #then
    expect(message.variant).toBe("low")
  })

  test("does not override existing variant", () => {
    // #given
    const config = {
      agents: {
        sisyphus: { variant: "low" },
      },
    } as OhMyOpenCodeConfig
    const message = { variant: "max" }

    // #when
    applyAgentVariant(config, "sisyphus", message)

    // #then
    expect(message.variant).toBe("max")
  })
})
