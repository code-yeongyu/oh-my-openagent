import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "../../shared/jsonc-parser"
import type { InstallConfig } from "../types"
import { resetConfigContext } from "./config-context"
import { generateOmoConfig } from "./generate-omo-config"
import { writeOmoConfig } from "./write-omo-config"

const installConfig: InstallConfig = {
  codexAutonomous: false,
  hasBailianCodingPlan: false,
  hasClaude: true,
  hasCodex: false,
  hasCopilot: false,
  hasGemini: true,
  hasKimiForCoding: false,
  hasMinimaxCnCodingPlan: false,
  hasMinimaxCodingPlan: false,
  hasOpenAI: true,
  hasOpenCode: true,
  hasOpencodeGo: false,
  hasOpencodeZen: false,
  hasSenpi: false,
  hasVercelAiGateway: false,
  hasZaiCodingPlan: false,
  isMax20: true,
  platform: "opencode",
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

describe("writeOmoConfig", () => {
  let homeDirectory = ""
  let originalHome: string | undefined

  beforeEach(() => {
    homeDirectory = join(tmpdir(), `omo-write-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    originalHome = process.env.HOME
    mkdirSync(homeDirectory, { recursive: true })
    process.env.HOME = homeDirectory
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(homeDirectory, { recursive: true, force: true })
    resetConfigContext()
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it("#given existing user settings #when writing install defaults #then user settings win within the unified block", () => {
    const path = join(homeDirectory, ".omo", "omo.jsonc")
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, JSON.stringify({
      "[opencode]": {
        agents: { sisyphus: { model: "custom/provider-model" } },
        disabled_hooks: ["comment-checker"],
      },
    }, null, 2) + "\n")

    const result = writeOmoConfig(installConfig)
    const document = parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))
    const config = record(document["[opencode]"])

    expect(result).toEqual({ success: true, configPath: path })
    expect(record(record(config.agents).sisyphus).model).toBe("custom/provider-model")
    expect(config.disabled_hooks).toEqual(["comment-checker"])
    for (const key of Object.keys(generateOmoConfig(installConfig))) expect(config).toHaveProperty(key)
  })

  it("#given no user config #when writing #then creates the user omo document", () => {
    const result = writeOmoConfig(installConfig)
    const path = join(homeDirectory, ".omo", "omo.jsonc")

    expect(result).toEqual({ success: true, configPath: path })
    expect(record(parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))["[opencode]"])).not.toEqual({})
  })
})
