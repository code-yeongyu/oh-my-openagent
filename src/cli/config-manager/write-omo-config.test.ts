import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "../../shared/jsonc-parser"
import type { InstallConfig } from "../types"
import { resetConfigContext } from "./config-context"
import { generateOmoConfig } from "./generate-omo-config"
import { writeOmoConfig } from "./write-omo-config"

const installConfig: InstallConfig = {
  hasClaude: true,
  isMax20: true,
  hasOpenAI: true,
  hasGemini: true,
  hasCopilot: false,
  hasOpencodeZen: false,
  hasZaiCodingPlan: false,
  hasKimiForCoding: false,
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

describe("writeOmoConfig", () => {
  let testConfigDir = ""
  let testConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-write-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "oh-my-openagent.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("preserves existing user values while adding new defaults", () => {
    // given
    const existingConfig = {
      agents: {
        sisyphus: {
          model: "custom/provider-model",
        },
      },
      disabled_hooks: ["comment-checker"],
    }
    writeFileSync(testConfigPath, JSON.stringify(existingConfig, null, 2) + "\n", "utf-8")

    const generatedDefaults = generateOmoConfig(installConfig)

    // when
    const result = writeOmoConfig(installConfig)

    // then
    expect(result.success).toBe(true)

    const savedConfig = parseJsonc<Record<string, unknown>>(readFileSync(testConfigPath, "utf-8"))
    const savedAgents = getRecord(savedConfig.agents)
    const savedSisyphus = getRecord(savedAgents.sisyphus)
    expect(savedSisyphus.model).toBe("custom/provider-model")
    expect(savedConfig.disabled_hooks).toEqual(["comment-checker"])

    for (const defaultKey of Object.keys(generatedDefaults)) {
      expect(savedConfig).toHaveProperty(defaultKey)
    }
  })

  it("migrates legacy oh-my-opencode.json to canonical oh-my-openagent.json before merging", () => {
    // given
    const legacyConfigPath = join(testConfigDir, "oh-my-opencode.json")
    const canonicalConfigPath = join(testConfigDir, "oh-my-openagent.json")
    const legacyBackupPath = `${legacyConfigPath}.bak`
    writeFileSync(
      legacyConfigPath,
      JSON.stringify(
        {
          agents: {
            sisyphus: {
              model: "custom/provider-model",
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    )

    // when
    const result = writeOmoConfig(installConfig)

    // then
    expect(result.success).toBe(true)
    expect(result.configPath).toEndWith("oh-my-openagent.json")
    expect(existsSync(legacyConfigPath)).toBe(false)
    expect(existsSync(legacyBackupPath)).toBe(true)
    expect(existsSync(canonicalConfigPath)).toBe(true)

    const savedConfig = parseJsonc<Record<string, unknown>>(readFileSync(canonicalConfigPath, "utf-8"))
    const savedAgents = getRecord(savedConfig.agents)
    const savedSisyphus = getRecord(savedAgents.sisyphus)
    expect(savedSisyphus.model).toBe("custom/provider-model")
  })
})
