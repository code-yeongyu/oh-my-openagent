/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearPluginConfigFileDetectionCache } from "../../../shared/jsonc-parser"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function createLspDistCli(workspaceDirectory: string): void {
  const lspDistDirectory = join(workspaceDirectory, "packages", "lsp-tools-mcp", "dist")
  mkdirSync(lspDistDirectory, { recursive: true })
  writeFileSync(join(lspDistDirectory, "cli.js"), "#!/usr/bin/env node\n", "utf-8")
}

afterEach(() => {
  clearPluginConfigFileDetectionCache()

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
    createLspDistCli(workspaceDirectory)
    writeFileSync(
      join(projectConfigDirectory, "oh-my-openagent.json"),
      JSON.stringify({ disabled_mcps: ["lsp"] }),
      "utf-8",
    )
    clearPluginConfigFileDetectionCache()

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-disabled`)

    // when
    const servers = getInstalledLspServers({ configDirectory: userConfigDirectory, cwd: workspaceDirectory })

    // then
    expect(servers).toEqual([])
  })

  it("returns bundled lsp server info when lsp MCP uses bootstrap fallback", async () => {
    // given
    const userConfigDirectory = createTemporaryDirectory("omo-tools-lsp-user-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-bootstrap-")
    clearPluginConfigFileDetectionCache()

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-bootstrap`)

    // when
    const servers = getInstalledLspServers({ configDirectory: userConfigDirectory, cwd: workspaceDirectory })

    // then
    expect(servers).toEqual([{ id: "lsp-tools-mcp", extensions: ["*"] }])
  })

  it("returns bundled lsp server info when MCP is enabled", async () => {
    // given
    const userConfigDirectory = createTemporaryDirectory("omo-tools-lsp-user-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-enabled-")
    createLspDistCli(workspaceDirectory)
    clearPluginConfigFileDetectionCache()

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-enabled`)

    // when
    const servers = getInstalledLspServers({ configDirectory: userConfigDirectory, cwd: workspaceDirectory })

    // then
    expect(servers).toEqual([{ id: "lsp-tools-mcp", extensions: ["*"] }])
  })

})
