import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadPluginConfig } from "../plugin-config"

const managedPluginConfigPath = new URL("../../assets/custom-opencode/oh-my-opencode.json", import.meta.url)
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }

  delete process.env.OPENCODE_CONFIG_DIR
})

describe("custom OpenCode config precedence compatibility", () => {
  it("loads user config first and lets project config override it without breaking merge semantics", () => {
    const projectDir = makeTempDir("config-precedence-project")
    const userConfigDir = makeTempDir("config-precedence-user")
    const projectConfigDir = join(projectDir, ".opencode")

    mkdirSync(projectConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    writeJson(join(userConfigDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          model: "openai/gpt-5.4",
          variant: "high",
          prompt_append: "User config should load first.",
        },
      },
      categories: {
        quick: {
          textVerbosity: "low",
        },
      },
      disabled_tools: ["read"],
      disabled_hooks: ["user-hook"],
    })

    writeJson(join(projectConfigDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          model: "anthropic/claude-opus-4-6",
          prompt_append: "Project config must win for overlapping fields.",
        },
      },
      categories: {
        quick: {
          model: "anthropic/claude-sonnet-4-6",
        },
      },
      disabled_tools: ["bash", "read"],
      disabled_hooks: ["project-hook"],
    })

    const config = loadPluginConfig(projectDir, {})

    expect(config.agents?.prometheus?.model).toBe("anthropic/claude-opus-4-6")
    expect(config.agents?.prometheus?.variant).toBe("high")
    expect(config.agents?.prometheus?.prompt_append).toBe(
      "Project config must win for overlapping fields."
    )
    expect(config.categories?.quick?.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.categories?.quick?.textVerbosity).toBe("low")
    expect(config.disabled_tools).toEqual(["read", "bash"])
    expect(config.disabled_hooks).toEqual(["user-hook", "project-hook"])
  })

  it("keeps the managed user asset as the base while allowing project-local overrides", () => {
    const projectDir = makeTempDir("config-precedence-managed-project")
    const userConfigDir = makeTempDir("config-precedence-managed-user")
    const projectConfigDir = join(projectDir, ".opencode")

    mkdirSync(projectConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = userConfigDir

    const managedUserConfig = JSON.parse(readFileSync(managedPluginConfigPath, "utf-8"))
    writeJson(join(userConfigDir, "oh-my-openagent.json"), managedUserConfig)

    writeJson(join(projectConfigDir, "oh-my-openagent.json"), {
      agents: {
        prometheus: {
          prompt_append: "Project-local compatibility override.",
        },
      },
      categories: {
        writing: {
          model: "anthropic/claude-sonnet-4-6",
        },
      },
      disabled_tools: ["bash"],
    })

    const config = loadPluginConfig(projectDir, {})

    expect(config.hashline_edit).toBe(true)
    expect(config.agents?.prometheus?.prompt_append).toBe("Project-local compatibility override.")
    expect(config.agents?.prometheus?.model).toBe("openai/gpt-5.4")
    expect(config.categories?.writing?.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.categories?.writing?.variant).toBe("xhigh")
    expect(config.categories?.writing?.textVerbosity).toBe("high")
    expect(config.disabled_tools).toEqual(["bash"])
  })
})
