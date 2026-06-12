/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const temporaryDirectories: string[] = []
const originalCwd = process.cwd()

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  process.chdir(originalCwd)

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("getUserMcpInfo", () => {
  it("loads valid project MCP servers", async () => {
    // given
    const workspaceDirectory = createTemporaryDirectory("omo-tools-mcp-valid-")
    process.chdir(workspaceDirectory)
    writeFileSync(
      join(workspaceDirectory, ".mcp.json"),
      JSON.stringify({ mcpServers: { example: { command: "node" } } }),
      "utf-8",
    )

    const { getUserMcpInfo } = await import(`./tools-mcp?t=${Date.now()}-valid`)

    // when
    const servers = getUserMcpInfo()

    // then
    expect(servers).toEqual([
      {
        id: "example",
        type: "user",
        enabled: true,
        valid: true,
        error: undefined,
      },
    ])
  })

  it("skips malformed MCP config files", async () => {
    // given
    const workspaceDirectory = createTemporaryDirectory("omo-tools-mcp-malformed-")
    process.chdir(workspaceDirectory)
    writeFileSync(join(workspaceDirectory, ".mcp.json"), "{", "utf-8")

    const { getUserMcpInfo } = await import(`./tools-mcp?t=${Date.now()}-malformed`)

    // when
    const servers = getUserMcpInfo()

    // then
    expect(servers).toEqual([])
  })

  it("marks non-object MCP server entries invalid", async () => {
    // given
    const workspaceDirectory = createTemporaryDirectory("omo-tools-mcp-invalid-")
    mkdirSync(join(workspaceDirectory, ".claude"), { recursive: true })
    process.chdir(workspaceDirectory)
    writeFileSync(
      join(workspaceDirectory, ".claude", ".mcp.json"),
      JSON.stringify({ mcpServers: { broken: "node" } }),
      "utf-8",
    )

    const { getUserMcpInfo } = await import(`./tools-mcp?t=${Date.now()}-invalid`)

    // when
    const servers = getUserMcpInfo()

    // then
    expect(servers).toEqual([
      {
        id: "broken",
        type: "user",
        enabled: true,
        valid: false,
        error: "Invalid configuration format",
      },
    ])
  })
})
