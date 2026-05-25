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
    it("returns unsupported_mcp_action when no operation specified", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      const result = await tool.execute({ mcp_name: "test-server" }, mockContext)

      // then
      expect(typeof result === "object" && result.metadata?.kind).toBe("unsupported_mcp_action")
      expect(typeof result === "object" ? result.output : result).toContain("Missing operation")
    })

    it("returns unsupported_mcp_action when multiple operations specified", async () => {
      // given
      const tool = createSkillMcpTool({
        manager,
        getLoadedSkills: () => loadedSkills,
        getSessionID: () => sessionID,
      })

      // when
      const result = await tool.execute({
        mcp_name: "test-server",
        tool_name: "some-tool",
        resource_name: "some://resource",
      }, mockContext)

      // then
      expect(typeof result === "object" && result.metadata?.kind).toBe("unsupported_mcp_action")
      expect(typeof result === "object" ? result.output : result).toContain("Multiple operations")
    })

    it("returns unsupported_mcp_action when mcp_name not found in any skill", async () => {
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

      // when
      const result = await tool.execute({ mcp_name: "unknown-server", tool_name: "some-tool" }, mockContext)

      // then
      expect(typeof result === "object" && result.metadata?.kind).toBe("unsupported_mcp_action")
      expect(typeof result === "object" ? result.output : result).toContain("not found")
    })

    it("includes available MCP servers in unsupported_mcp_action response", async () => {
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

      // when
      const result = await tool.execute({ mcp_name: "missing", tool_name: "test" }, mockContext)

      // then
      expect(typeof result === "object" && result.metadata?.kind).toBe("unsupported_mcp_action")
      const output = typeof result === "object" ? result.output : result
      expect(output).toMatch(/sqlite.*db-skill|rest-api.*api-skill/s)
    })

    it("returns unsupported_mcp_action on invalid JSON arguments", async () => {
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

      // when
      const result = await tool.execute({
        mcp_name: "test-server",
        tool_name: "some-tool",
        arguments: "not valid json",
      }, mockContext)

      // then
      expect(typeof result === "object" && result.metadata?.kind).toBe("unsupported_mcp_action")
      expect(typeof result === "object" ? result.output : result).toContain("Invalid arguments JSON")
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

    it("passes toolContext.directory to the manager", async () => {
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
        getSessionID: () => "session-1",
      })

      // when
      await tool.execute({ mcp_name: "test-server", tool_name: "some-tool" }, mockContext)

      // then
      expect(callToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/test" }),
        expect.any(Object),
        "some-tool",
        {},
      )
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
