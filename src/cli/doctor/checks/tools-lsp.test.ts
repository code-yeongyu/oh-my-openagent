/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"

const originalCwd = process.cwd()
const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  mock.restore()
  clearPluginConfigFileDetectionCache()
  process.chdir(originalCwd)

  if (originalOpenCodeConfigDir === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR
  } else {
    process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("getInstalledLspServers", () => {
  it("returns empty when lsp MCP is disabled via config", async () => {
    // given
    const userConfigDirectory = createTemporaryDirectory("omo-tools-lsp-user-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-workspace-")
    const projectConfigDirectory = join(workspaceDirectory, ".opencode")
    mkdirSync(projectConfigDirectory, { recursive: true })
    writeFileSync(
      join(projectConfigDirectory, "oh-my-openagent.json"),
      JSON.stringify({ disabled_mcps: ["lsp"] }),
      "utf-8",
    )
    process.env.OPENCODE_CONFIG_DIR = userConfigDirectory
    process.chdir(workspaceDirectory)
    clearPluginConfigFileDetectionCache()

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-disabled`)

    // when
    const servers = getInstalledLspServers()

    // then
    expect(servers).toEqual([])
  })

  it("returns bundled lsp server info when MCP is enabled and available", async () => {
    // given
    const userConfigDirectory = createTemporaryDirectory("omo-tools-lsp-user-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-enabled-")
    const lspCliDirectory = join(workspaceDirectory, "packages", "lsp-tools-mcp", "dist")
    mkdirSync(lspCliDirectory, { recursive: true })
    writeFileSync(join(lspCliDirectory, "cli.js"), "#!/usr/bin/env node\n", "utf-8")
    process.env.OPENCODE_CONFIG_DIR = userConfigDirectory
    process.chdir(workspaceDirectory)
    clearPluginConfigFileDetectionCache()

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-enabled`)

    // when
    const servers = getInstalledLspServers()

    // then
    expect(servers).toEqual([{ id: "lsp-tools-mcp", extensions: ["*"] }])
  })

})
