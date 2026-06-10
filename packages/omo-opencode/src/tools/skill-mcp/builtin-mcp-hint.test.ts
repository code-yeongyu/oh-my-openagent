import { describe, it, expect } from "bun:test"

import { SkillMcpManager } from "../../features/skill-mcp-manager"
import { createSkillMcpTool } from "./tools"

const mockContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("skill_mcp builtin MCP hint", () => {
  it("returns builtin hint for context7", async () => {
    const tool = createSkillMcpTool({
      manager: new SkillMcpManager(),
      getLoadedSkills: () => [],
      getSessionID: () => "session",
    })

    await expect(
      tool.execute({ mcp_name: "context7", tool_name: "resolve-library-id" }, mockContext),
    ).rejects.toThrow(/builtin MCP/)

    await expect(
      tool.execute({ mcp_name: "context7", tool_name: "resolve-library-id" }, mockContext),
    ).rejects.toThrow(/context7_resolve-library-id/)
  })

  it("keeps skill-loading hint for unknown MCP names", async () => {
    const tool = createSkillMcpTool({
      manager: new SkillMcpManager(),
      getLoadedSkills: () => [],
      getSessionID: () => "session",
    })

    await expect(
      tool.execute({ mcp_name: "unknown-mcp", tool_name: "x" }, mockContext),
    ).rejects.toThrow(/Load the skill first/)
  })
})
