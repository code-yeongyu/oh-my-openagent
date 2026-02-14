import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { resolve } from "path"
import { MCB_TOOL_NAMES, type McbToolName } from "./types"
import { createMcbTestClient, type McbTestClient } from "./mcb-client-helper"

const mcbAvailable = Bun.which("mcb") !== null
const configPath = resolve(import.meta.dir, "test-mcb.toml")
const dbPath = `/tmp/mcb-e2e-tier1-${Date.now()}.db`

describe.skipIf(!mcbAvailable)("mcb-integration: e2e tier1 connection lifecycle", () => {
  let testClient: McbTestClient

  beforeAll(async () => {
    testClient = await createMcbTestClient(60_000, configPath, {
      MCP__AUTH__USER_DB_PATH: dbPath,
    })
  }, 60_000)

  afterAll(async () => {
    await testClient?.close()
  })

  //#given a connected real mcb client
  //#when tools are listed
  //#then all expected tool names are present
  test("lists all 9 expected mcb tools", async () => {
    const result = await testClient.client.listTools()
    const names = new Set(result.tools.map((tool) => tool.name as McbToolName))
    expect(result.tools.length).toBe(9)
    for (const expectedName of MCB_TOOL_NAMES) {
      expect(names.has(expectedName)).toBe(true)
    }
  }, 10_000)

  //#given a connected real mcb client
  //#when tool schemas are inspected
  //#then each tool exposes an object input schema
  test("exposes input schema for all tools", async () => {
    const result = await testClient.client.listTools()
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined()
      expect(typeof tool.inputSchema).toBe("object")
      const schema = tool.inputSchema as { type?: unknown }
      expect(schema.type).toBe("object")
    }
  }, 10_000)

  //#given a connected real mcb client
  //#when the client is closed twice
  //#then close remains safe and idempotent
  test("closes safely multiple times", async () => {
    const localClient = await createMcbTestClient(60_000, configPath, {
      MCP__AUTH__USER_DB_PATH: `/tmp/mcb-e2e-tier1-local-${Date.now()}.db`,
    })
    await expect(localClient.close()).resolves.toBeUndefined()
    await expect(localClient.close()).resolves.toBeUndefined()
  }, 60_000)

  //#given an invalid mcb command
  //#when connection is attempted
  //#then the client connection fails gracefully
  test("fails to connect with invalid command", async () => {
    const transport = new StdioClientTransport({ command: "mcb-not-found", args: ["serve"], stderr: "pipe" })
    const client = new Client({ name: "mcb-e2e-test", version: "0.1.0" }, { capabilities: {} })
    await expect(client.connect(transport)).rejects.toBeDefined()
    await transport.close().catch(() => undefined)
  }, 10_000)
})
