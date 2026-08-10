import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { handleMemoryMcpRequest } from "./memory-server"

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-mcp-"))
  roots.push(root)
  return {
    cwd: join(root, "project"),
    env: { ...process.env, OMO_MEMORY_HOME: join(root, "memory-home") },
  }
}

function body(result: { content?: unknown } | undefined): string {
  const content = result?.content
  if (!Array.isArray(content)) return ""
  return content.map((item) => (item as { text?: string }).text ?? "").join("")
}

afterEach(() => {
  // Windows keeps git's handles open briefly after the child exits, so a bare recursive remove
  // throws EBUSY and fails the test that already passed. Retry the unlink instead.
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

// Each case drives real git subprocesses through a fresh repository; the 5s default is not a
// budget these operations fit on a loaded Windows runner.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)

describe("omo-memory MCP server", () => {
  test("#given initialize #then server info and tool capabilities are returned", async () => {
    const result = await handleMemoryMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const payload = result?.result as { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } } | undefined
    expect(payload?.serverInfo?.name).toBe("omo-memory")
    expect(payload?.capabilities?.tools).toBeDefined()
  })

  test("#given tools/list #then exactly the two memory tools are exposed", async () => {
    const result = await handleMemoryMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    const tools = (result?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(["memory", "memory_apply_patch"])
  })

  test("#given a fresh project #when create then str_replace run through tools/call #then the memory repo records them", async () => {
    const { cwd, env } = fixture()
    const created = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory", arguments: {
        command: "create", reason: "Record preference", file_path: "system/human/preferences.md",
        description: "User preferences", file_text: "theme: dark",
      } } },
      { cwd, env },
    )
    expect(body(created?.result as { content?: unknown })).toContain("Memory create committed locally")

    const replaced = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "memory", arguments: {
        command: "str_replace", reason: "Switch theme", file_path: "system/human/preferences.md",
        old_string: "theme: dark", new_string: "theme: light",
      } } },
      { cwd, env },
    )
    expect(body(replaced?.result as { content?: unknown })).toContain("Memory str_replace committed locally")

    const agentsDir = join(String(env.OMO_MEMORY_HOME), "agents")
    const identityDir = readdirSync(agentsDir)[0]
    expect(identityDir).toBeDefined()
    const profile = readFileSync(
      join(agentsDir, String(identityDir), "repo", "system/human/preferences.md"),
      "utf8",
    )
    expect(profile).toContain("theme: light")
  })

  test("#given an unknown tool name #when called #then an error result is returned", async () => {
    const { cwd, env } = fixture()
    const result = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } },
      { cwd, env },
    )
    expect((result?.result as { isError?: boolean } | undefined)?.isError).toBe(true)
  })
})
