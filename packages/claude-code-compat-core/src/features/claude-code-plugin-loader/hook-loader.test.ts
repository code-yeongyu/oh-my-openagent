import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPluginHooksConfigs } from "./hook-loader"
import type { LoadedPlugin } from "./types"

// Regression coverage for #4458 - every command/http action loaded from a
// plugin's hooks config must carry the plugin's installPath as `pluginRoot`
// so the downstream dispatcher can export CLAUDE_PLUGIN_ROOT on the spawn.
describe("loadPluginHooksConfigs pluginRoot stamping (#4458)", () => {
  let tempDirectory = ""

  beforeEach(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), "omo-hook-loader-"))
  })

  afterEach(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })

  function makePlugin(pluginName: string, hooksJson: unknown): LoadedPlugin {
    const installPath = join(tempDirectory, pluginName)
    const hooksPath = join(installPath, "hooks.json")
    // Use mkdir via writeFileSync target dir trick - easier to just create the
    // install dir explicitly.
    rmSync(installPath, { recursive: true, force: true })
    const fs = require("node:fs") as typeof import("node:fs")
    fs.mkdirSync(installPath, { recursive: true })
    writeFileSync(hooksPath, JSON.stringify(hooksJson), "utf-8")
    return {
      name: pluginName,
      version: "0.0.0",
      scope: "user",
      installPath,
      pluginKey: `${pluginName}@test`,
      hooksPath,
    }
  }

  test("#given a plugin hooks config #when loaded #then every command action carries pluginRoot=installPath", () => {
    // given
    const plugin = makePlugin("hello-plugin", {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "echo hi" },
              { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/foo.sh" },
            ],
          },
        ],
      },
    })

    // when
    const configs = loadPluginHooksConfigs([plugin])

    // then
    expect(configs).toHaveLength(1)
    const matchers = configs[0]?.hooks?.UserPromptSubmit ?? []
    expect(matchers).toHaveLength(1)
    const actions = matchers[0]?.hooks ?? []
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.type).toBe("command")
      // Type narrowing for the test: command-type entries should carry pluginRoot.
      expect((action as { pluginRoot?: string }).pluginRoot).toBe(plugin.installPath)
    }
  })

  test("#given an http action #when loaded #then it also carries pluginRoot", () => {
    // given
    const plugin = makePlugin("http-plugin", {
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "http", url: "https://example.test/hook" },
            ],
          },
        ],
      },
    })

    // when
    const configs = loadPluginHooksConfigs([plugin])

    // then
    const action = configs[0]?.hooks?.PostToolUse?.[0]?.hooks?.[0]
    expect(action?.type).toBe("http")
    expect((action as { pluginRoot?: string }).pluginRoot).toBe(plugin.installPath)
  })
})
