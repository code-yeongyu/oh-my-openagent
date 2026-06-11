import { describe, expect, it } from "bun:test"
import { registerTargetSkillMcpTool } from "./skill-mcp-tool"
import type { TargetToolDefinition } from "../host-tools"

describe("target skill MCP tool", () => {
  it("#given a skill frontmatter MCP and two sessions #when calls execute #then the target passes isolated session keys", async () => {
    const sessionIDs: string[] = []
    let currentSession = "session-a"
    let targetTool: TargetToolDefinition | undefined
    registerTargetSkillMcpTool({
      host: "pi",
      cwd: "/tmp",
      sessionID: () => currentSession,
      registry: { registerTool: (tool) => { targetTool = tool } },
      discoverSkills: async () => [{
        name: "fixture",
        scope: "project",
        definition: { name: "fixture", description: "fixture", template: "" },
        mcpConfig: { echo: { type: "stdio", command: "echo-server" } },
      }],
      manager: {
        callTool: async (info) => {
          sessionIDs.push(info.sessionID)
          return [{ type: "text", text: "ok" }]
        },
        readResource: async () => [],
        getPrompt: async () => [],
        disconnectSession: async () => {},
      },
    })

    await targetTool?.execute("one", { mcp_name: "echo", tool_name: "run" })
    currentSession = "session-b"
    await targetTool?.execute("two", { mcp_name: "echo", tool_name: "run" })

    expect(sessionIDs).toEqual(["session-a", "session-b"])
  })
})
