import { describe, expect, test } from "bun:test"
import type { MatrixxConfig } from "./config"
import { expandProfile } from "./config/profiles"
import { mergeConfigs } from "./plugin-config"

describe("profile expansion in mergeConfigs", () => {
  test("profile-only config sets agent models from profile", () => {
    //#given
    const profileDefaults = expandProfile("balanced") as MatrixxConfig
    const userConfig: MatrixxConfig = {}

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.agents?.morpheus?.model).toBe(
      "anthropic/claude-opus-4-6"
    )
    expect(result.agents?.oracle?.model).toBe(
      "anthropic/claude-sonnet-4-6"
    )
  })

  test("explicit agent override wins over profile default", () => {
    //#given
    const profileDefaults = expandProfile("budget") as MatrixxConfig
    const userConfig: MatrixxConfig = {
      agents: {
        morpheus: { model: "anthropic/claude-opus-4-6" },
      },
    }

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.agents?.morpheus?.model).toBe(
      "anthropic/claude-opus-4-6"
    )
    expect(result.agents?.oracle?.model).toBe("anthropic/claude-haiku-4-5")
  })

  test("explicit category override wins over profile default", () => {
    //#given
    const profileDefaults = expandProfile("budget") as MatrixxConfig
    const userConfig: MatrixxConfig = {
      categories: {
        source: { model: "anthropic/claude-opus-4-6" },
      },
    }

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.categories?.["source"]?.model).toBe(
      "anthropic/claude-opus-4-6"
    )
    expect(result.categories?.["bullet-time"]?.model).toBe("anthropic/claude-haiku-4-5")
  })

  test("no profile leaves config unchanged", () => {
    //#given
    const base: MatrixxConfig = {}
    const override: MatrixxConfig = {
      agents: { morpheus: { model: "some-model" } },
    }

    //#when
    const result = mergeConfigs(base, override)

    //#then
    expect(result.agents?.morpheus?.model).toBe("some-model")
    expect(result.agents?.oracle).toBeUndefined()
  })
})
