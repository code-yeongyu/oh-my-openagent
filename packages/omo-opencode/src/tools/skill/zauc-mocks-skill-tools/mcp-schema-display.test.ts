/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, spyOn } from "bun:test"
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js"
import { SkillMcpManager } from "../../../features/skill-mcp-manager"
import type { LoadedSkill } from "../../../features/opencode-skill-loader/types"
import { createMockSkillWithMcp, createSkillTool, mockContext } from "./test-support"

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
    it("uses the tool context sessionID when the fallback getter is empty", async () => {
      loadedSkills = [
        createMockSkillWithMcp("test-skill", {
          playwright: { command: "npx", args: ["-y", "@anthropic-ai/mcp-playwright"] },
        }),
      ]

      const listToolsSpy = spyOn(manager, "listTools").mockResolvedValue([])
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => "",
      })

      await tool.execute({ name: "test-skill" }, mockContext)

      expect(listToolsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sessionID: mockContext.sessionID }),
        expect.any(Object),
      )
    })

    it("displays tool inputSchema when available", async () => {
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

      spyOn(manager, "listTools").mockResolvedValue(mockToolsWithSchema)
      spyOn(manager, "listResources").mockResolvedValue([])
      spyOn(manager, "listPrompts").mockResolvedValue([])

      const tool = createSkillTool({
        skills: loadedSkills,
        mcpManager: manager,
        getSessionID: () => sessionID,
      })

      const result = await tool.execute({ name: "test-skill" }, mockContext)

      expect(result).toContain("browser_type")
      expect(result).toContain("inputSchema")
      expect(result).toContain("element")
      expect(result).toContain("ref")
      expect(result).toContain("text")
      expect(result).toContain("submit")
      expect(result).toContain("required")
    })

    it("displays multiple tools with their schemas", async () => {
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

      const result = await tool.execute({ name: "playwright-skill" }, mockContext)

      expect(result).toContain("browser_navigate")
      expect(result).toContain("browser_click")
      expect(result).toContain("url")
      expect(result).toContain("Navigate to a URL")
    })

    it("handles tools without inputSchema gracefully", async () => {
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

      const result = await tool.execute({ name: "simple-skill" }, mockContext)

      expect(result).toContain("simple_tool")
    })

    it("formats schema in a way LLM can understand for skill_mcp calls", async () => {
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

      const result = await tool.execute({ name: "db-skill" }, mockContext)

      expect(result).toContain("sqlite")
      expect(result).toContain("query")
      expect(result).toContain("sql")
      expect(result).toContain("required")
      expect(result).toMatch(/sql[\s\S]*string/i)
    })
  })
})
