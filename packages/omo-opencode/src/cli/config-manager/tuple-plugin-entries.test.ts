import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"
import { resetConfigContext } from "./config-context"
import { detectCurrentConfig } from "./detect-current-config"
import * as pluginNameWithVersion from "./plugin-name-with-version"

describe("addPluginToOpenCodeConfig - tuple plugin entries", () => {
  let testConfigDir = ""
  let getPluginNameWithVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-tuple-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
    getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent")
  })

  afterEach(() => {
    getPluginNameWithVersionSpy.mockRestore()
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("#given json config with a tuple entry #when adding the plugin #then it does not throw and keeps the tuple intact", async () => {
    // given
    const configPath = join(testConfigDir, "opencode.json")
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["some-plugin@1.2.3", { enabled: true }]] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([["some-plugin@1.2.3", { enabled: true }], "oh-my-openagent"])
  })

  it("#given jsonc config with a tuple entry #when adding the plugin #then the rewritten file keeps the options object", async () => {
    // given
    const configPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(
      configPath,
      '{\n  // keep this comment\n  "plugin": [["some-plugin@1.2.3", { "enabled": true }]]\n}\n',
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(configPath, "utf-8")
    expect(savedContent).not.toContain("[object Object]")
    expect(savedContent).toContain("// keep this comment")

    const savedConfig = JSON.parse(
      savedContent.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n"),
    )
    expect(savedConfig.plugin).toEqual([["some-plugin@1.2.3", { enabled: true }], "oh-my-openagent"])
  })

  it("#given a tuple entry for our own plugin #when adding the plugin #then it is replaced and its options survive", async () => {
    // given
    const configPath = join(testConfigDir, "opencode.json")
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["oh-my-opencode@3.10.0", { verbose: true }], "other-plugin"] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["other-plugin", ["oh-my-openagent", { verbose: true }]])
  })

  it("#given a tuple entry alongside our entry #when detecting the current config #then the install is still detected", () => {
    // given
    const configPath = join(testConfigDir, "opencode.json")
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["some-plugin@1.2.3", { enabled: true }], "oh-my-openagent@3.11.0"] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.installedVersion).toBe("3.11.0")
  })

  it("#given our plugin declared as a tuple #when detecting the current config #then the pinned version is read from the entry name", () => {
    // given
    const configPath = join(testConfigDir, "opencode.json")
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["oh-my-openagent@3.11.0", { verbose: true }]] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.installedVersion).toBe("3.11.0")
  })

  it("#given a tuple entry pinned above the install version #when adding the plugin #then the downgrade is blocked", async () => {
    // given
    const versionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.15.0")
    const configPath = join(testConfigDir, "opencode.json")
    writeFileSync(
      configPath,
      JSON.stringify({ plugin: [["oh-my-openagent@3.16.0", { verbose: true }]] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.15.0")

    // then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Downgrade")
    const savedConfig = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([["oh-my-openagent@3.16.0", { verbose: true }]])
    versionSpy.mockRestore()
  })
})
