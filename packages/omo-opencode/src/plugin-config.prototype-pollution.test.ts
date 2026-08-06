import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { validatePluginConfig } from "./config/validate"
import { mergeConfigs } from "./plugin-config"
import { OhMyOpenCodeConfigSchema } from "./config"

const temporaryDirectories: string[] = []
let homeDirectory: string | undefined

function hasOwnKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

afterEach(() => {
  if (homeDirectory === undefined) delete process.env.HOME
  else process.env.HOME = homeDirectory
  homeDirectory = undefined
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("plugin config prototype pollution guards", () => {
  it("#given unsafe nested merge keys #when merging config #then prototypes remain unmodified", () => {
    const base = OhMyOpenCodeConfigSchema.parse({ agents: { oracle: { model: "base/model" } } })
    const override = OhMyOpenCodeConfigSchema.parse({
      agents: JSON.parse('{"__proto__":{"polluted":true},"oracle":{"temperature":0.4}}'),
    })

    const result = mergeConfigs(base, override)

    expect(result.agents?.oracle).toMatchObject({ model: "base/model", temperature: 0.4 })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(hasOwnKey(result.agents ?? {}, "__proto__")).toBe(false)
  })

  it("#given unsafe project omo input #when loading the unified chain #then safe values load without prototype pollution", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-config-proto-"))
    temporaryDirectories.push(root)
    const project = join(root, "project")
    homeDirectory = process.env.HOME
    process.env.HOME = root
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(
      join(project, ".omo", "omo.jsonc"),
      '{"__proto__":{"polluted":true},"[opencode]":{"agents":{"oracle":{"model":"safe/model"}}}}',
    )

    const result = validatePluginConfig(project)

    expect(result.valid).toBe(false)
    expect(result.config.agents?.oracle).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(hasOwnKey(result.config, "__proto__")).toBe(false)
  })
})
