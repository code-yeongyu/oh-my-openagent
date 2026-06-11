import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetAdditionalAllowedMcpEnvVars } from "../features/claude-code-mcp-loader"
import { loadTargetMcpInventory } from "./target-mcp-config"

const directories: string[] = []

afterEach(() => {
  resetAdditionalAllowedMcpEnvVars()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  delete process.env.OMO_MCP_TEST_TOKEN
})

describe("target MCP config", () => {
  it("#given target cwd #when inventory loads #then built-in MCP configs are present", () => {
    const cwd = mkdtempSync(join(tmpdir(), "omo-target-mcp-"))
    directories.push(cwd)

    const inventory = loadTargetMcpInventory({ cwd, home: cwd })

    expect(inventory.sources.lsp).toBe("builtin")
    expect(inventory.sources.ast_grep).toBe("builtin")
    expect(inventory.sources.context7).toBe("builtin")
  })

  it("#given Claude MCP config and user allowlist #when inventory loads #then project server and allowed env expand", () => {
    const cwd = mkdtempSync(join(tmpdir(), "omo-target-mcp-"))
    directories.push(cwd)
    mkdirSync(join(cwd, ".claude"), { recursive: true })
    process.env.OMO_MCP_TEST_TOKEN = "allowed-value"
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          project_server: {
            type: "stdio",
            command: "example",
            args: ["${OMO_MCP_TEST_TOKEN}"],
          },
        },
      }),
    )

    const inventory = loadTargetMcpInventory({
      cwd,
      home: cwd,
      envAllowlist: ["OMO_MCP_TEST_TOKEN"],
    })

    expect(inventory.sources.project_server).toBe("project")
    expect(inventory.servers.project_server).toMatchObject({
      type: "local",
      command: ["example", "allowed-value"],
    })
  })
})
