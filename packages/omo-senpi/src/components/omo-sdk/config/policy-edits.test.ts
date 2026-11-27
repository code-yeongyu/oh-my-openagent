import { afterEach, describe, expect, test } from "bun:test"

import { configSandbox, type ConfigSandbox, LAUNCH, valueOf } from "./config-sandbox.test-support"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

const OPUS_55 = `${LAUNCH.provider}/${LAUNCH.model}`

describe("config.check writes nothing", () => {
  test("#given edits to every kind of file #when they are checked #then no file under the sandbox changes", async () => {
    sandbox = configSandbox()
    sandbox.userConfig({ categories: { quick: { model: OPUS_55 } } })
    sandbox.engineGlobal({ compaction: { enabled: true } })
    const before = sandbox.snapshot()
    valueOf(
      await sandbox.config().check({
        edits: [
          { path: "categories.quick.model", value: "openai/gpt-5.5" },
          { path: "categories.writing.model", value: OPUS_55, scope: "project" },
          { path: "engine:compaction.enabled", value: false },
          { path: "engine:compaction.speculativeFraction", value: 0.5, scope: "project" },
        ],
      }),
    )
    expect(sandbox.snapshot()).toEqual(before)
  })
})

describe("config.check edit paths", () => {
  test.each([
    ["__proto__.pollutedByCheck"],
    ["constructor.prototype.pollutedByCheck"],
    ["categories.__proto__.pollutedByCheck"],
    ["engine:__proto__.pollutedByCheck"],
  ])("#given the edit path %s #when it is checked #then it is refused and no prototype changes", async (path) => {
    sandbox = configSandbox()
    const result = await sandbox.config().check({ edits: [{ path, value: true }] })

    expect(result.kind === "error" ? result.error.code : result.kind).toBe("path_not_allowed")
    expect(Object.hasOwn(Object.prototype, "pollutedByCheck")).toBe(false)
  })

  test("#given a prototype key as a path segment array #when it is checked #then it is refused", async () => {
    sandbox = configSandbox()
    const result = await sandbox.config().check({ edits: [{ path: ["agents", "__proto__", "model"], value: "x" }] })

    expect(result.kind === "error" ? result.error.code : result.kind).toBe("path_not_allowed")
    expect(Object.hasOwn(Object.prototype, "model")).toBe(false)
  })
})
