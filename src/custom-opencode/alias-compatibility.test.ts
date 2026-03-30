import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { loadPluginConfig } from "../plugin-config"
import { detectPluginConfigFile } from "../shared/jsonc-parser"

const tempDirs: string[] = []

function makeTempDir(prefix: string) {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function assertLegacyBasename(filePath: string, scope: string) {
  if (!basename(filePath).startsWith("oh-my-opencode")) {
    throw new Error(`${scope} must keep legacy oh-my-opencode basename support.`)
  }

  return filePath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }

  delete process.env.OPENCODE_CONFIG_DIR
})

describe("legacy alias and basename compatibility", () => {
  it("prefers the legacy basename when both plugin config names exist in the same directory", () => {
    const configDir = makeTempDir("alias-compat-detect")

    writeJson(join(configDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          model: "google/gemini-3-flash",
        },
      },
    })
    writeJson(join(configDir, "oh-my-opencode.json"), {
      agents: {
        prometheus: {
          model: "openai/gpt-5.4",
        },
      },
    })

    const detected = detectPluginConfigFile(configDir)

    expect(detected.format).toBe("json")
    expect(assertLegacyBasename(detected.path, "Plugin config detection")).toBe(
      join(configDir, "oh-my-opencode.json")
    )
  })

  it("loads legacy user and project basenames even when canonical siblings are present", () => {
    const projectDir = makeTempDir("alias-compat-project")
    const userConfigDir = makeTempDir("alias-compat-user")
    const projectConfigDir = join(projectDir, ".opencode")

    mkdirSync(projectConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    writeJson(join(userConfigDir, "oh-my-opencode.json"), {
      agents: {
        prometheus: {
          model: "openai/gpt-5.4",
          variant: "high",
        },
      },
    })
    writeJson(join(userConfigDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          model: "google/gemini-3-flash",
          variant: "low",
        },
      },
    })

    writeJson(join(projectConfigDir, "oh-my-opencode.json"), {
      agents: {
        prometheus: {
          prompt_append: "Project legacy override stays compatible.",
        },
      },
    })
    writeJson(join(projectConfigDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          prompt_append: "Canonical sibling should not win while legacy compatibility is enabled.",
        },
      },
    })

    const config = loadPluginConfig(projectDir, {})

    expect(config.agents?.prometheus?.model).toBe("openai/gpt-5.4")
    expect(config.agents?.prometheus?.variant).toBe("high")
    expect(config.agents?.prometheus?.prompt_append).toBe(
      "Project legacy override stays compatible."
    )
  })

  it("fails loudly when legacy basename support disappears", () => {
    expect(() =>
      assertLegacyBasename("E:/tmp/oh-my-openagent.json", "Plugin config detection")
    ).toThrow("Plugin config detection must keep legacy oh-my-opencode basename support.")
  })
})
