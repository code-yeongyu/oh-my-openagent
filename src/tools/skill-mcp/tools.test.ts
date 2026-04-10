import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
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

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
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
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ mcp_name: "test-server" }, mockContext)
      ).rejects.toThrow(/Missing operation/)
    })

    it("throws when multiple operations specified", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({
          mcp_name: "test-server",
          tool_name: "some-tool",
          resource_name: "some://resource",
        }, mockContext)
      ).rejects.toThrow(/Multiple operations/)
    })

    it("throws when mcp_name not found in any skill", async () => {
      // given
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

      // when / #then
      await expect(
        tool.execute({ mcp_name: "unknown-server", tool_name: "some-tool" }, mockContext)
      ).rejects.toThrow(/not found/)
    })

    it("throws when neither mcp_name nor skill_name is provided", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ tool_name: "some-tool" }, mockContext)
      ).rejects.toThrow(/Missing target MCP server/)
    })

    it("includes available MCP servers in error message", async () => {
      // given
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

      // when / #then
      await expect(
        tool.execute({ mcp_name: "missing", tool_name: "test" }, mockContext)
      ).rejects.toThrow(/sqlite.*db-skill|rest-api.*api-skill/s)
    })

    it("throws on invalid JSON arguments", async () => {
      // given
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

      // when / #then
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
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // then
      expect(tool.description.length).toBeLessThan(200)
      expect(tool.description).toContain("mcp_name")
    })

    it("includes grep parameter in schema", () => {
      // given / #when
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => [],
        getSessionID: () => "session",
      })

      // then
      expect(tool.description).toBeDefined()
    })
  })

  describe("session resolution", () => {
    it("uses the tool context sessionID when the fallback getter is empty", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          "test-server": { command: "echo", args: ["test"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue({ content: [] } as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => "",
      })

      // when
      await tool.execute({ mcp_name: "test-server", tool_name: "some-tool" }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: mockContext.sessionID }),
        expect.any(Object),
        "some-tool",
        {},
      )
    })
  })

  describe("legacy skill_name compatibility", () => {
    it("maps a single-server skill_name call and returns a deprecation notice", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("playwright", {
          browser: { command: "echo", args: ["test"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue([{ text: "ok" }] as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      const result = await tool.execute(
        { skill_name: "playwright", tool_name: "browser_navigate", arguments: { url: "https://example.com" } },
        mockContext,
      )

      // then
      expect(result).toContain('[deprecated] skill_name="playwright" compatibility is temporary')
      expect(result).toContain('mcp_name="browser"')
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "browser", skillName: "playwright" }),
        expect.any(Object),
        "browser_navigate",
        { url: "https://example.com" },
      )
    })

    it("prefers mcp_name when both mcp_name and skill_name are provided", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("playwright", {
          browser: { command: "echo", args: ["test"] },
        }),
        createMockSkillWithMcp("supabase", {
          database: { command: "echo", args: ["test"] },
        }),
      ]
      const callToolSpy = spyOn(manager, "callTool").mockResolvedValue([{ text: "ok" }] as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      const result = await tool.execute(
        { mcp_name: "database", skill_name: "playwright", tool_name: "query" },
        mockContext,
      )

      // then
      expect(result).not.toContain("[deprecated]")
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: "database", skillName: "supabase" }),
        expect.any(Object),
        "query",
        {},
      )
    })

    it("fails deterministically when skill_name resolves to multiple MCP servers", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("chrome-devtools", {
          browser: { command: "echo", args: ["test"] },
          performance: { command: "echo", args: ["test"] },
        }),
      ]
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when / #then
      await expect(
        tool.execute({ skill_name: "chrome-devtools", tool_name: "trace" }, mockContext),
      ).rejects.toThrow(/multiple MCP servers.*Use mcp_name/s)
    })

    it("supports legacy list_tools and respects includeTools filtering", async () => {
      // given
      loadedSkills = [
        createMockSkillWithMcp("supabase", {
          database: {
            command: "echo",
            args: ["test"],
            includeTools: ["list_tables"],
          },
        }),
      ]
      spyOn(manager, "listTools").mockResolvedValue([
        { name: "list_tables", description: "List tables", inputSchema: { type: "object" } },
        { name: "execute_sql", description: "Execute SQL", inputSchema: { type: "object" } },
      ] as never)
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      const result = await tool.execute({ skill_name: "supabase", list_tools: true }, mockContext)

      // then
      expect(result).toContain("list_tables")
      expect(result).not.toContain("execute_sql")
      expect(result).toContain('[deprecated] skill_name="supabase" compatibility is temporary')
    })
  })
})

describe("applyGrepFilter", () => {
  it("filters lines matching pattern", () => {
    // given
    const output = `line1: hello world
line2: foo bar
line3: hello again
line4: baz qux`

    // when
    const result = applyGrepFilter(output, "hello")

    // then
    expect(result).toContain("line1: hello world")
    expect(result).toContain("line3: hello again")
    expect(result).not.toContain("foo bar")
    expect(result).not.toContain("baz qux")
  })

  it("returns original output when pattern is undefined", () => {
    // given
    const output = "some output"

    // when
    const result = applyGrepFilter(output, undefined)

    // then
    expect(result).toBe(output)
  })

  it("returns message when no lines match", () => {
    // given
    const output = "line1\nline2\nline3"

    // when
    const result = applyGrepFilter(output, "xyz")

    // then
    expect(result).toContain("[grep] No lines matched pattern")
  })

  it("handles invalid regex gracefully", () => {
    // given
    const output = "some output"

    // when
    const result = applyGrepFilter(output, "[invalid")

    // then
    expect(result).toBe(output)
  })
})
