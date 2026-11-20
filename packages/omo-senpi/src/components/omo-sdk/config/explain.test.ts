import { afterEach, describe, expect, test } from "bun:test"

import { configSandbox, type ConfigSandbox, errorOf, valueOf } from "./config-sandbox.test-support"
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

describe("config.explain omo keys", () => {
  test("#given the user and project layers set one key #when it is explained #then the project value wins and each layer's value is listed", async () => {
    sandbox = configSandbox()
    const user = sandbox.userConfig({ categories: { quick: { model: "openai/gpt-5.5" } } })
    const project = sandbox.projectConfig({ categories: { quick: { model: "anthropic/claude-haiku-5-5" } } })
    const explained = valueOf(await sandbox.config().explain({ path: "categories.quick.model" }))
    expect(explained).toMatchObject({
      path: "categories.quick.model",
      set: true,
      value: "anthropic/claude-haiku-5-5",
      source: "project",
    })
    expect(explained.layers).toEqual([
      { scope: "user", file: user, set: true, value: "openai/gpt-5.5" },
      { scope: "project", file: project, set: true, value: "anthropic/claude-haiku-5-5" },
    ])
  })

  test("#given a builtin category key no layer sets #when it is explained #then it is known and unset", async () => {
    sandbox = configSandbox()
    const explained = valueOf(await sandbox.config().explain({ path: "categories.deep-low.model" }))
    expect(explained).toMatchObject({ set: false, source: "unset" })
  })

  test("#given a key under a category that does not exist #when it is explained #then it answers unknown_path with the nearest valid paths", async () => {
    sandbox = configSandbox()
    const config = sandbox.config()
    const error = errorOf(await config.explain({ path: "categories.nope.model" }))
    expect(error.code).toBe("unknown_path")
    const nearest = error.details?.["nearest"] as readonly string[]
    expect(nearest.length).toBeGreaterThan(0)
    for (const path of nearest) expect((await config.explain({ path })).kind).toBe("ok")
  })
})

describe("config.explain engine keys", () => {
  test("#given a global engine setting #when its engine: key is explained #then the global value wins over the default", async () => {
    sandbox = configSandbox()
    const global = sandbox.engineGlobal({ compaction: { enabled: false } })
    const explained = valueOf(await sandbox.config().explain({ path: "engine:compaction.enabled" }))
    expect(explained).toMatchObject({ set: true, value: false, source: "global", default: true })
    expect(explained.layers).toContainEqual({ scope: "global", file: global, set: true, value: false })
  })

  test("#given no settings #when a model's fallback chain is explained #then the default chain answers", async () => {
    sandbox = configSandbox()
    const explained = valueOf(
      await sandbox.config().explain({ path: "engine:retry.fallbackChains.claude-opus-5-5" }),
    )
    expect(explained).toMatchObject({ set: true, source: "default", value: ENGINE_DEFAULT_FALLBACK_CHAINS["claude-opus-5-5"] })
  })

  test("#given an engine key the SDK does not know #when it is explained #then it answers unknown_path", async () => {
    sandbox = configSandbox()
    const error = errorOf(await sandbox.config().explain({ path: "engine:compaction.nope" }))
    expect(error.code).toBe("unknown_path")
    expect(error.details?.["nearest"]).toContain("engine:compaction.enabled")
  })
})
