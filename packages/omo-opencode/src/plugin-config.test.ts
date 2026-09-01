import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OhMyOpenCodeConfigSchema } from "./config"
import { loadPluginConfig, mergeConfigs } from "./plugin-config"

const temporaryDirectories: string[] = []
let homeDirectory: string | undefined

function writeOmoConfig(path: string, config: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config)}\n`, "utf-8")
}

afterEach(() => {
  if (homeDirectory === undefined) delete process.env.HOME
  else process.env.HOME = homeDirectory
  homeDirectory = undefined
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("plugin config", () => {
  it("#given compatible plugin config sections #when merging #then keyed sections merge and disabled lists union", () => {
    const base = OhMyOpenCodeConfigSchema.parse({
      agents: { oracle: { model: "base/model" } },
      disabled_hooks: ["comment-checker"],
    })
    const override = OhMyOpenCodeConfigSchema.parse({
      agents: { oracle: { temperature: 0.4 } },
      disabled_hooks: ["model-fallback"],
    })

    const result = mergeConfigs(base, override)

    expect(result.agents?.oracle).toMatchObject({ model: "base/model", temperature: 0.4 })
    expect(result.disabled_hooks).toEqual(["comment-checker", "model-fallback"])
  })

  it("#given user and project omo config views #when loading #then the unified chain resolves the opencode view", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-plugin-config-"))
    temporaryDirectories.push(root)
    const project = join(root, "project")
    homeDirectory = process.env.HOME
    process.env.HOME = root
    writeOmoConfig(join(root, ".omo", "omo.jsonc"), {
      "[opencode]": { agents: { oracle: { model: "user/model", prompt: "user prompt" } } },
    })
    writeOmoConfig(join(project, ".omo", "omo.jsonc"), {
      "[opencode]": { agents: { oracle: { temperature: 0.4 } } },
    })

    const config = loadPluginConfig(project, { command: "run" })

    expect(config.agents?.oracle).toMatchObject({ model: "user/model", prompt: "user prompt", temperature: 0.4 })
  })
})
