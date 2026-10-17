import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getConfigNotices } from "./adapter/migration-notices"
import { lspInstallDecisionsPath, projectLspConfigPaths, userLspConfigPath } from "./config-paths"

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

function writeConfig(root: string, brandDir: ".omo" | ".pi", file = "lsp-client.json", content = '{"lsp":{}}'): string {
  mkdirSync(join(root, brandDir), { recursive: true })
  const path = join(root, brandDir, file)
  writeFileSync(path, content)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("senpi LSP config paths follow the branded .omo dir (#8370)", () => {
  it("#given the user config was migrated to ~/.omo #when the user config path is resolved #then ~/.omo/lsp-client.json is read", () => {
    // given: the brand-dir migration moved ~/.pi/lsp-client.json to ~/.omo/lsp-client.json
    const home = tempDir("omo-lsp-home-")
    const migrated = writeConfig(home, ".omo")

    // when / then
    expect(userLspConfigPath(home)).toBe(migrated)
  })

  it("#given only an unmigrated ~/.pi config #when the user config path is resolved #then ~/.pi stays a read-only fallback", () => {
    // given
    const home = tempDir("omo-lsp-home-")
    const legacy = writeConfig(home, ".pi")

    // when / then
    expect(userLspConfigPath(home)).toBe(legacy)
  })

  it("#given both ~/.omo and ~/.pi configs #when the user config path is resolved #then the branded dir wins", () => {
    // given
    const home = tempDir("omo-lsp-home-")
    const branded = writeConfig(home, ".omo")
    writeConfig(home, ".pi")

    // when / then
    expect(userLspConfigPath(home)).toBe(branded)
  })

  it("#given no user config or install decisions #when paths are resolved #then both default to the branded dir", () => {
    // given
    const home = tempDir("omo-lsp-home-")

    // when / then
    expect(userLspConfigPath(home)).toBe(join(home, ".omo", "lsp-client.json"))
    expect(lspInstallDecisionsPath(home)).toBe(join(home, ".omo", "lsp-install-decisions.json"))
  })

  it("#given a project directory #when project config paths are listed #then .omo is searched before .pi", () => {
    // given
    const cwd = tempDir("omo-lsp-project-")

    // when / then
    expect(projectLspConfigPaths(cwd)).toEqual([join(cwd, ".omo", "lsp-client.json"), join(cwd, ".pi", "lsp-client.json")])
  })

  it("#given a migrated project config with a custom command #when config notices are read #then the notice points at the .omo file", () => {
    // given
    const cwd = tempDir("omo-lsp-project-")
    const projectConfig = writeConfig(cwd, ".omo", "lsp-client.json", JSON.stringify({ lsp: { custom: { command: ["custom-lsp"], extensions: [".zz"] } } }))
    const originalCwd = process.cwd()
    process.chdir(cwd)
    try {
      // when
      const notices = getConfigNotices()

      // then
      expect(notices).toHaveLength(1)
      expect(notices[0]?.configPath).toBe(projectConfig)
      expect(notices[0]?.serverIds).toEqual(["custom"])
    } finally {
      process.chdir(originalCwd)
    }
  })
})
