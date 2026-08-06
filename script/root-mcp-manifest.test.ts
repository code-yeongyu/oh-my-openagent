import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

describe("root MCP manifest", () => {
  test("#given root codegraph MCP #when loaded outside this machine #then it uses the portable codegraph command", async () => {
    // given
    const manifestPath = join(import.meta.dir, "..", ".mcp.json")

    // when
    const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"))

    // then
    expect(readCodegraphMcp(manifest)).toEqual({
      type: "stdio",
      command: "codegraph",
      args: ["serve", "--mcp"],
    })
  })
})

function readCodegraphMcp(manifest: unknown): unknown {
  if (!isRecord(manifest)) {
    return undefined
  }
  const mcpServers = manifest["mcpServers"]
  if (!isRecord(mcpServers)) {
    return undefined
  }
  return mcpServers["codegraph"]
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}
