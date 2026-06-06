import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import * as logger from "../../../shared/logger"

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
  it("skips malformed MCP config files and logs the parse failure", async () => {
    // given
    const workspaceDirectory = createTemporaryDirectory("omo-tools-mcp-")
    const claudeDirectory = join(workspaceDirectory, ".claude")
    mkdirSync(claudeDirectory, { recursive: true })
    writeFileSync(join(workspaceDirectory, ".mcp.json"), "{", "utf-8")
    writeFileSync(
      join(claudeDirectory, ".mcp.json"),
      JSON.stringify({ mcpServers: { good: { command: "echo" } } }),
      "utf-8",
    )
    process.chdir(workspaceDirectory)
    const logSpy = spyOn(logger, "log").mockImplementation(() => {})

    const { getUserMcpInfo } = await import(`./tools-mcp?t=${Date.now()}-malformed`)

    try {
      // when
      const servers = getUserMcpInfo()

      // then
      expect(servers).toEqual([
        {
          id: "good",
          type: "user",
          enabled: true,
          valid: true,
          error: undefined,
        },
      ])
      expect(logSpy).toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })
})
