/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryDirectories: string[] = []

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function createLspDistCli(workspaceDirectory: string): void {
  const directory = join(workspaceDirectory, "packages", "lsp-tools-mcp", "dist")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "cli.js"), "#!/usr/bin/env node\n", "utf-8")
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("getInstalledLspServers", () => {
  it("#given an omo project view disabling lsp #when checking servers #then returns none", async () => {
    const homeDirectory = createTemporaryDirectory("omo-tools-lsp-home-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-workspace-")
    const configPath = join(workspaceDirectory, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    createLspDistCli(workspaceDirectory)
    writeFileSync(configPath, JSON.stringify({ "[opencode]": { disabled_mcps: ["lsp"] } }))

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-disabled`)

    expect(getInstalledLspServers({ homeDir: homeDirectory, cwd: workspaceDirectory })).toEqual([])
  })

  it("#given no lsp override #when checking servers #then exposes the bundled server", async () => {
    const homeDirectory = createTemporaryDirectory("omo-tools-lsp-home-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-enabled-")
    createLspDistCli(workspaceDirectory)

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-enabled`)

    expect(getInstalledLspServers({ homeDir: homeDirectory, cwd: workspaceDirectory })).toEqual([
      { id: "lsp-tools-mcp", extensions: ["*"] },
    ])
  })

  it("#given malformed omo config #when checking servers #then keeps the bundled server available", async () => {
    const homeDirectory = createTemporaryDirectory("omo-tools-lsp-home-")
    const workspaceDirectory = createTemporaryDirectory("omo-tools-lsp-malformed-")
    const configPath = join(homeDirectory, ".omo", "omo.jsonc")
    mkdirSync(join(configPath, ".."), { recursive: true })
    writeFileSync(configPath, "{", "utf-8")

    const { getInstalledLspServers } = await import(`./tools-lsp?t=${Date.now()}-malformed`)

    expect(getInstalledLspServers({ homeDir: homeDirectory, cwd: workspaceDirectory })).toEqual([
      { id: "lsp-tools-mcp", extensions: ["*"] },
    ])
  })
})
