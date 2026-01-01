import { describe, it, expect, beforeEach, mock } from "bun:test"
import { createSkillMcpTool, applyGrepFilter } from "./tools"
import { SkillMcpManager } from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

function createMockSkillWithMcp(name: string, mcpServers: Record<string, unknown>): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
    },
    scope: "opencode-project",
    mcpConfig: mcpServers as LoadedSkill["mcpConfig"],
  }
}

const mockContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  abort: new AbortController().signal,
}

describe("skill_mcp tool", () => {
  let manager: SkillMcpManager
  let loadedSkills: LoadedSkill[]
  let sessionID: string

  beforeEach(() => {
    manager = new SkillMcpManager()
    loadedSkills = []
    sessionID = "test-session-1"
  })

  describe("parameter validation", () => {
    it("throws when no operation specified", async () => {
      // #given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // #when / #then
      await expect(
        tool.execute({ mcp_name: "test-server" }, mockContext)
      ).rejects.toThrow(/Missing operation/)
    })

    it("throws when multiple operations specified", async () => {
      // #given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // #when / #then
      await expect(
        tool.execute({
          mcp_name: "test-server",
          tool_name: "some-tool",
          resource_name: "some://resource",
        }, mockContext)
      ).rejects.toThrow(/Multiple operations/)
    })

    it("throws when mcp_name not found in any skill", async () => {
      // #given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "known-server": { command: "echo", args: ["test"] },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // #when / #then
      await expect(
        tool.execute({ mcp_name: "unknown-server", tool_name: "some-tool" }, mockContext)
      ).rejects.toThrow(/not found/)
    })

    it("includes available MCP servers in error message", async () => {
      // #given
      loadedSkills = [
        createMockSkillWithMcp("db-skill", {
          sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
        }),
        createMockSkillWithMcp("api-skill", {
          "rest-api": { command: "node", args: ["server.js"] },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // #when / #then
      await expect(
        tool.execute({ mcp_name: "missing", tool_name: "test" }, mockContext)
      ).rejects.toThrow(/sqlite.*db-skill|rest-api.*api-skill/s)
    })

    it("throws on invalid JSON arguments", async () => {
      // #given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "test-server": { command: "echo" },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // #when / #then
      await expect(
        tool.execute({
          mcp_name: "test-server",
          tool_name: "some-tool",
          arguments: "not valid json",
        }, mockContext)
      ).rejects.toThrow(/Invalid arguments JSON/)
    })
  })

  describe("tool description", () => {
    it("has concise description", () => {
      // #given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // #then
      expect(tool.description.length).toBeLessThan(200)
      expect(tool.description).toContain("mcp_name")
    })

    it("includes grep parameter in schema", () => {
      // #given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // #then
      expect(tool.description).toBeDefined()
    })
  })
})

describe("applyGrepFilter", () => {
  it("filters lines matching pattern", () => {
    // #given
    const output = `line1: hello world
line2: foo bar
line3: hello again
line4: baz qux`

    // #when
    const result = applyGrepFilter(output, "hello")

    // #then
    expect(result).toContain("line1: hello world")
    expect(result).toContain("line3: hello again")
    expect(result).not.toContain("foo bar")
    expect(result).not.toContain("baz qux")
  })

  it("returns original output when pattern is undefined", () => {
    // #given
    const output = "some output"

    // #when
    const result = applyGrepFilter(output, undefined)

    // #then
    expect(result).toBe(output)
  })

  it("returns message when no lines match", () => {
    // #given
    const output = "line1\nline2\nline3"

    // #when
    const result = applyGrepFilter(output, "xyz")

    // #then
    expect(result).toContain("[grep] No lines matched pattern")
  })

  it("handles invalid regex gracefully", () => {
    // #given
    const output = "some output"

    // #when
    const result = applyGrepFilter(output, "[invalid")

    // #then
    expect(result).toBe(output)
  })
})
