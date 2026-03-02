import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { createSkillManageTool } from "./tools"
import type { SkillManageResult } from "./types"
import * as skillDiscovery from "../../features/opencode-skill-loader/skill-discovery"
import * as skillToolModule from "../skill/tools"

function content(description: string, body = "body"): string {
  return `---\ndescription: ${description}\n---\n${body}`
}

function createPluginContext(directory: string): PluginInput {
  return {
    directory,
    client: {} as PluginInput["client"],
  } as PluginInput
}

function parseResult(raw: string): SkillManageResult {
  return JSON.parse(raw) as SkillManageResult
}

describe("skill_manage tool", () => {
  let tempDir: string
  let originalOpenCodeConfigDir: string | undefined
  let originalClaudeConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skill-manage-tools-"))
    originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = join(tempDir, "opencode-config")
    process.env.CLAUDE_CONFIG_DIR = join(tempDir, "claude-config")
    mkdirSync(process.env.OPENCODE_CONFIG_DIR, { recursive: true })
    mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
  })

  afterEach(() => {
    if (originalOpenCodeConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir

    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir

    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("#given project scope skill lifecycle", () => {
    it("#when create list read edit delete #then full CRUD succeeds", async () => {
      const tool = createSkillManageTool(createPluginContext(tempDir))

      const createResult = parseResult(await tool.execute({
        op: "create",
        scope: "project",
        name: "roundtrip-skill",
        content: content("initial", "first"),
      }))
      expect(createResult.op).toBe("create")

      const listResult = parseResult(await tool.execute({ op: "list" }))
      if (listResult.op !== "list") throw new Error("Unexpected list result")
      expect(listResult.skills.some((skill) => skill.name === "roundtrip-skill")).toBe(true)

      const readResult = parseResult(await tool.execute({ op: "read", name: "roundtrip-skill" }))
      if (readResult.op !== "read") throw new Error("Unexpected read result")
      expect(readResult.content).toContain("description: initial")

      const editResult = parseResult(await tool.execute({
        op: "edit",
        scope: "project",
        name: "roundtrip-skill",
        content: content("updated", "second"),
      }))
      expect(editResult.op).toBe("edit")

      const readAfterEdit = parseResult(await tool.execute({ op: "read", name: "roundtrip-skill" }))
      if (readAfterEdit.op !== "read") throw new Error("Unexpected read result")
      expect(readAfterEdit.content).toContain("description: updated")

      const deleteResult = parseResult(await tool.execute({ op: "delete", scope: "project", name: "roundtrip-skill" }))
      expect(deleteResult.op).toBe("delete")

      await expect(tool.execute({ op: "read", name: "roundtrip-skill" })).rejects.toThrow(/not found/)
    })
  })

  describe("#given explicit scopes", () => {
    it("#when using user scope #then routes to opencode config skills directory", async () => {
      const tool = createSkillManageTool(createPluginContext(tempDir))

      const result = parseResult(await tool.execute({
        op: "create",
        scope: "user",
        name: "user-scope-skill",
        content: content("user skill"),
      }))

      if (result.op !== "create") throw new Error("Unexpected create result")
      expect(result.path).toContain(join("opencode-config", "skills", "user-scope-skill.md"))
      expect(readFileSync(result.path, "utf8")).toContain("description: user skill")
    })

    it("#when creating project skill with lower-scope duplicate #then returns conflict warning", async () => {
      const configSkillsDir = join(process.env.OPENCODE_CONFIG_DIR!, "skills")
      mkdirSync(configSkillsDir, { recursive: true })
      writeFileSync(join(configSkillsDir, "shared-skill.md"), content("existing config"), "utf8")

      const tool = createSkillManageTool(createPluginContext(tempDir))
      const result = parseResult(await tool.execute({
        op: "create",
        scope: "project",
        name: "shared-skill",
        content: content("project version"),
      }))

      if (result.op !== "create") throw new Error("Unexpected create result")
      expect(result.warnings.some((warning) => warning.includes("shadow"))).toBe(true)
    })

    it("#when deleting project skill with lower-scope duplicate #then returns unshadow warning", async () => {
      const configSkillsDir = join(process.env.OPENCODE_CONFIG_DIR!, "skills")
      mkdirSync(configSkillsDir, { recursive: true })
      writeFileSync(join(configSkillsDir, "delete-shadow.md"), content("existing config"), "utf8")

      const tool = createSkillManageTool(createPluginContext(tempDir))
      await tool.execute({
        op: "create",
        scope: "project",
        name: "delete-shadow",
        content: content("project version"),
      })

      const result = parseResult(await tool.execute({ op: "delete", scope: "project", name: "delete-shadow" }))
      if (result.op !== "delete") throw new Error("Unexpected delete result")
      expect(result.warnings.some((warning) => warning.includes("unshadow"))).toBe(true)
    })
  })

  describe("#given mutation operations", () => {
    it("#when writes succeed #then clears discovery and skill tool caches", async () => {
      const clearDiscoverySpy = spyOn(skillDiscovery, "clearSkillCache")
      const clearToolSpy = spyOn(skillToolModule, "clearSkillToolCaches")
      const tool = createSkillManageTool(createPluginContext(tempDir))

      await tool.execute({ op: "create", scope: "project", name: "cache-test", content: content("cache") })
      await tool.execute({ op: "edit", scope: "project", name: "cache-test", content: content("cache-edit") })
      await tool.execute({ op: "delete", scope: "project", name: "cache-test" })

      expect(clearDiscoverySpy).toHaveBeenCalledTimes(3)
      expect(clearToolSpy).toHaveBeenCalledTimes(3)
    })
  })
})
