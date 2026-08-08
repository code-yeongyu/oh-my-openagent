import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "slow-server", version: "1.0.0" })

server.registerTool(
  "wait",
  { description: "Sleeps for the given number of seconds, then returns", inputSchema: { seconds: z.number() } },
  async ({ seconds }) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    return { content: [{ type: "text" as const, text: `waited ${seconds}s` }] }
  },
)

await server.connect(new StdioServerTransport())
