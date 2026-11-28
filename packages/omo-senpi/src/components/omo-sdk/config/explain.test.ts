import { afterEach, describe, expect, test } from "bun:test"

import { configSandbox, type ConfigSandbox, errorOf, valueOf } from "./config-sandbox.test-support"
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

describe("config.explain routing keys", () => {
  test("#given the user and project layers set one key #when it is explained #then the project value wins and each layer's value is listed by scope", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: "openai/gpt-5.5" } } })
    sandbox.projectConfig({ categories: { quick: { model: "anthropic/claude-haiku-5-5" } } })
    expect(valueOf(await sandbox.config().explain({ path: "categories.quick.model" }))).toEqual({
      path: "categories.quick.model",
      set: true,
      value: "anthropic/claude-haiku-5-5",
      source: "project",
      layers: [
        { scope: "user", set: true, value: "openai/gpt-5.5" },
        { scope: "project", set: true, value: "anthropic/claude-haiku-5-5" },
      ],
    })
  })

  test("#given an upper-case credential prefix under the model key #when it is explained #then the value is withheld", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: "SK-PROJ-CANARY-1" } } })
    const answer = valueOf(await sandbox.config().explain({ path: "categories.quick.model" }))
    expect(answer).toMatchObject({ set: true, value_withheld: true, source: "user" })
    expect(JSON.stringify(answer)).not.toContain("CANARY")
  })

  test("#given a model list with object entries #when it is explained #then each entry keeps only model, variant and reasoning", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({
      agents: { explore: { models: ["openai/gpt-5.5", { model: "anthropic/claude-haiku-5-5", reasoning: "low" }] } },
    })
    expect(valueOf(await sandbox.config().explain({ path: "agents.explore.models" }))).toMatchObject({
      set: true,
      source: "user",
      value: ["openai/gpt-5.5", { model: "anthropic/claude-haiku-5-5", reasoning: "low" }],
    })
  })

  test("#given a builtin category key no layer sets #when it is explained #then it is known and unset", async () => {
    sandbox = configSandbox()
    expect(valueOf(await sandbox.config().explain({ path: "categories.deep-low.model" }))).toMatchObject({
      set: false,
      source: "unset",
    })
  })

  test("#given a category only a config file defines and one nobody defines #when each is explained #then both answer the same path_not_allowed", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { "zz-guessed": { model: "openai/gpt-5.5" } } })
    const config = sandbox.config()
    const defined = await config.explain({ path: "categories.zz-guessed.model" })
    const undefinedName = await config.explain({ path: "categories.zz-nobody.model" })
    expect(errorOf(defined).code).toBe("path_not_allowed")
    expect(defined).toEqual(undefinedName)
  })

  test("#given a key outside the allowlist #when it is explained #then it answers path_not_allowed with example paths only", async () => {
    sandbox = configSandbox()
    const error = errorOf(await sandbox.config().explain({ path: "categories.quick.description" }))
    expect(error.code).toBe("path_not_allowed")
    expect(error.details?.["allowed"]).toContain("categories.<name>.model")
  })
})

describe("config.explain engine keys", () => {
  test("#given a fallback chain key an object inherits #when it is explained #then it is unset or refused, never a withheld default", async () => {
    sandbox = configSandbox()
    const config = sandbox.config()
    expect(valueOf(await config.explain({ path: "engine:retry.fallbackChains.constructor" }))).toEqual({
      path: "engine:retry.fallbackChains.constructor",
      set: false,
      source: "unset",
      layers: [],
    })
    expect(errorOf(await config.explain({ path: "engine:retry.fallbackChains.__proto__" })).code).toBe(
      "path_not_allowed",
    )
  })

  test("#given a global engine setting #when its engine: key is explained #then the global value wins over the default", async () => {
    sandbox = configSandbox()
    sandbox.engineGlobal({ compaction: { enabled: false } })
    const explained = valueOf(await sandbox.config().explain({ path: "engine:compaction.enabled" }))
    expect(explained).toMatchObject({ set: true, value: false, source: "global", default: true })
    expect(explained.layers).toEqual([{ scope: "global", set: true, value: false }])
  })

  test("#given no settings #when a token budget key is explained #then the engine default answers", async () => {
    sandbox = configSandbox()
    expect(valueOf(await sandbox.config().explain({ path: "engine:compaction.reserveTokens" }))).toEqual({
      path: "engine:compaction.reserveTokens",
      set: true,
      value: 16_384,
      source: "default",
      default: 16_384,
      layers: [],
    })
  })

  test("#given a project setting of the wrong type #when it is explained #then the value is withheld", async () => {
    sandbox = configSandbox()
    sandbox.engineProject({ retry: { fallbackRevertPolicy: "sometimes" } })
    expect(valueOf(await sandbox.config().explain({ path: "engine:retry.fallbackRevertPolicy" }))).toMatchObject({
      set: true,
      value_withheld: true,
      source: "project",
    })
  })

  test("#given no settings #when a model's fallback chain is explained #then the default chain answers", async () => {
    sandbox = configSandbox()
    const explained = valueOf(await sandbox.config().explain({ path: "engine:retry.fallbackChains.claude-opus-5-5" }))
    expect(explained).toMatchObject({
      set: true,
      source: "default",
      value: ENGINE_DEFAULT_FALLBACK_CHAINS["claude-opus-5-5"],
    })
  })

  test("#given an engine key the SDK does not allow #when it is explained #then it answers path_not_allowed", async () => {
    sandbox = configSandbox()
    const error = errorOf(await sandbox.config().explain({ path: "engine:compaction.nope" }))
    expect(error.code).toBe("path_not_allowed")
    expect(error.details?.["allowed"]).toContain("engine:compaction.enabled")
  })
})
