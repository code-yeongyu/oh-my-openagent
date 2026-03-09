import { describe, expect, test } from "bun:test"
import { mergeConfigs } from "./plugin-config"
import { expandProfile } from "./config/profiles"
import type { MatrixxConfig } from "./config"

describe("profile expansion in mergeConfigs", () => {
  test("profile-only config sets agent models from profile", () => {
    //#given
    const profileDefaults = expandProfile("balanced") as MatrixxConfig
    const userConfig: MatrixxConfig = {}

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.agents?.morpheus?.model).toBe(
      "google-vertex-anthropic/claude-opus-4-6@default"
    )
    expect(result.agents?.oracle?.model).toBe(
      "google-vertex-anthropic/claude-sonnet-4-6@default"
    )
  })

  test("explicit agent override wins over profile default", () => {
    //#given
    const profileDefaults = expandProfile("budget") as MatrixxConfig
    const userConfig: MatrixxConfig = {
      agents: {
        morpheus: { model: "google-vertex-anthropic/claude-opus-4-6@default" },
      },
    }

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.agents?.morpheus?.model).toBe(
      "google-vertex-anthropic/claude-opus-4-6@default"
    )
    expect(result.agents?.oracle?.model).toBe("google-vertex/gemini-3.1-pro-preview")
  })

  test("explicit category override wins over profile default", () => {
    //#given
    const profileDefaults = expandProfile("budget") as MatrixxConfig
    const userConfig: MatrixxConfig = {
      categories: {
        source: { model: "google-vertex-anthropic/claude-opus-4-6@default" },
      },
    }

    //#when
    const result = mergeConfigs(profileDefaults, userConfig)

    //#then
    expect(result.categories?.["source"]?.model).toBe(
      "google-vertex-anthropic/claude-opus-4-6@default"
    )
    expect(result.categories?.["bullet-time"]?.model).toBe("google-vertex/gemini-2.5-flash")
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
