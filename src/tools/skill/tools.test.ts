import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import * as fs from "node:fs"
import { createSkillTool } from "./tools"
import { SkillMcpManager } from "../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js"

const originalReadFileSync = fs.readFileSync.bind(fs)

mock.module("node:fs", () => ({
  ...fs,
  readFileSync: (path: string, encoding?: string) => {
    if (typeof path === "string" && path.includes("/skills/")) {
      return `---
description: Test skill description
---
Test skill body content`
    }
    return originalReadFileSync(path, encoding as BufferEncoding)
  },
}))

function createMockSkill(name: string, options: { agent?: string } = {}): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
      agent: options.agent,
    },
    scope: "opencode-project",
  }
}

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

describe("skill tool - synchronous description", () => {
  it("includes available_skills immediately when skills are pre-provided", () => {
    // #given
    const loadedSkills = [createMockSkill("test-skill")]

    // #when
    const tool = createSkillTool({ skills: loadedSkills })

    // #then
    expect(tool.description).toContain("<available_skills>")
    expect(tool.description).toContain("test-skill")
  })

  it("includes all pre-provided skills in available_skills immediately", () => {
    // #given
    const loadedSkills = [
      createMockSkill("playwright"),
      createMockSkill("frontend-ui-ux"),
      createMockSkill("git-master"),
    ]

    // #when
    const tool = createSkillTool({ skills: loadedSkills })

    // #then
    expect(tool.description).toContain("playwright")
    expect(tool.description).toContain("frontend-ui-ux")
    expect(tool.description).toContain("git-master")
  })

  it("shows no-skills message immediately when empty skills are pre-provided", () => {
    // #given / #when
    const tool = createSkillTool({ skills: [] })

    // #then
    expect(tool.description).toContain("No skills are currently available")
  })
})

describe("skill tool - agent restriction", () => {
  it("allows skill without agent restriction to any agent", async () => {
    // #given
    const loadedSkills = [createMockSkill("public-skill")]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "any-agent" }

    // #when
    const result = await tool.execute({ name: "public-skill" }, context)

    // #then
    expect(result).toContain("public-skill")
  })

  it("allows skill when agent matches restriction", async () => {
    // #given
    const loadedSkills = [createMockSkill("restricted-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "sisyphus" }

    // #when
    const result = await tool.execute({ name: "restricted-skill" }, context)

    // #then
    expect(result).toContain("restricted-skill")
  })

  it("throws error when agent does not match restriction", async () => {
    // #given
    const loadedSkills = [createMockSkill("sisyphus-only-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "oracle" }

    // #when / #then
    await expect(tool.execute({ name: "sisyphus-only-skill" }, context)).rejects.toThrow(
      'Skill "sisyphus-only-skill" is restricted to agent "sisyphus"'
    )
  })

  it("throws error when context agent is undefined for restricted skill", async () => {
    // #given
    const loadedSkills = [createMockSkill("sisyphus-only-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const contextWithoutAgent = { ...mockContext, agent: undefined as unknown as string }

    // #when / #then
    await expect(tool.execute({ name: "sisyphus-only-skill" }, contextWithoutAgent)).rejects.toThrow(
      'Skill "sisyphus-only-skill" is restricted to agent "sisyphus"'
    )
  })

})

describe("skill tool - MCP schema display", () => {
  let manager: SkillMcpManager
  let loadedSkills: LoadedSkill[]
  let sessionID: string

  beforeEach(() => {
    manager = new SkillMcpManager()
    loadedSkills = []
    sessionID = "test-session-1"
  })

  describe("formatMcpCapabilities with inputSchema", () => {
    it("displays tool inputSchema when available", async () => {
      // #given
      const mockToolsWithSchema: McpTool[] = [
        {
          name: "browser_type",
          description: "Type text into an element",
          inputSchema: {
            type: "object",
            properties: {
              element: { type: "string", description: "Human-readable element description" },
              ref: { type: "string", description: "Element reference from page snapshot" },
              text: { type: "string", description: "Text to type into the element" },
              submit: { type: "boolean", description: "Submit form after typing" },
            },
            required: ["element", "ref", "text"],
          },
        },
      ]

      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          playwright: { command: "npx", args: ["-y", "@anthropic-ai/mcp-playwright"] },
        }),
      ]

      // Mock manager.listTools to return our mock tools
      spyOn(manager, "listTools").mockResolvedValue(mockToolsWithSchema)
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => sessionID,
      })

      // #when
      const result = await tool.execute({ name: "test-skill" }, mockContext)

      // #then
      // Should include inputSchema details
      expect(result).toContain("browser_type")
      expect(result).toContain("inputSchema")
      expect(result).toContain("element")
      expect(result).toContain("ref")
      expect(result).toContain("text")
      expect(result).toContain("submit")
      expect(result).toContain("required")
    })

    it("displays multiple tools with their schemas", async () => {
      // #given
      const mockToolsWithSchema: McpTool[] = [
        {
          name: "browser_navigate",
          description: "Navigate to a URL",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to navigate to" },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_click",
          description: "Click an element",
          inputSchema: {
            type: "object",
            properties: {
              element: { type: "string" },
              ref: { type: "string" },
            },
            required: ["element", "ref"],
          },
        },
      ]

      loadedSkills = [
        createMockSkillWithMcp("playwright-skill", {
          playwright: { command: "npx", args: ["-y", "@anthropic-ai/mcp-playwright"] },
        }),
      ]

      spyOn(manager, "listTools").mockResolvedValue(mockToolsWithSchema)
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => sessionID,
      })

      // #when
      const result = await tool.execute({ name: "playwright-skill" }, mockContext)

      // #then
      expect(result).toContain("browser_navigate")
      expect(result).toContain("browser_click")
      expect(result).toContain("url")
      expect(result).toContain("Navigate to a URL")
    })

    it("handles tools without inputSchema gracefully", async () => {
      // #given
      const mockToolsMinimal: McpTool[] = [
        {
          name: "simple_tool",
          inputSchema: { type: "object" },
        },
      ]

      loadedSkills = [
        createMockSkillWithMcp("simple-skill", {
          simple: { command: "echo", args: ["test"] },
        }),
      ]

      spyOn(manager, "listTools").mockResolvedValue(mockToolsMinimal)
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => sessionID,
      })

      // #when
      const result = await tool.execute({ name: "simple-skill" }, mockContext)

      // #then
      expect(result).toContain("simple_tool")
      // Should not throw, should handle gracefully
    })

    it("formats schema in a way LLM can understand for skill_mcp calls", async () => {
      // #given
      const mockTools: McpTool[] = [
        {
          name: "query",
          description: "Execute SQL query",
          inputSchema: {
            type: "object",
            properties: {
              sql: { type: "string", description: "SQL query to execute" },
              params: { type: "array", description: "Query parameters" },
            },
            required: ["sql"],
          },
        },
      ]

      loadedSkills = [
        createMockSkillWithMcp("db-skill", {
          sqlite: { command: "uvx", args: ["mcp-server-sqlite"] },
        }),
      ]

      spyOn(manager, "listTools").mockResolvedValue(mockTools)
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => sessionID,
      })

      // #when
      const result = await tool.execute({ name: "db-skill" }, mockContext)

      // #then
      // Should provide enough info for LLM to construct valid skill_mcp call
      expect(result).toContain("sqlite")
      expect(result).toContain("query")
      expect(result).toContain("sql")
      expect(result).toContain("required")
      expect(result).toMatch(/sql[\s\S]*string/i)
    })
  })
})
