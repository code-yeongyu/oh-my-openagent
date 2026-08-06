/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSkillCache } from "../../../features/opencode-skill-loader/skill-content"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - dynamic discovery", () => {
  it("caches discovered skills across tool instances until the shared cache resets", async () => {
    clearSkillCache()
    const originalDirectory = process.cwd()
    const temporaryDirectory = fs.mkdtempSync(join(tmpdir(), "skill-tool-cache-"))
    const initialSkillDirectory = join(temporaryDirectory, ".opencode", "skills", "initial-skill")
    const secondSkillDirectory = join(temporaryDirectory, ".opencode", "skills", "second-skill")

    fs.mkdirSync(initialSkillDirectory, { recursive: true })
    fs.writeFileSync(join(initialSkillDirectory, "SKILL.md"), "---\ndescription: Initial skill\n---\nInitial skill body")
    process.chdir(temporaryDirectory)

    try {
      const firstTool = createSkillTool({ directory: temporaryDirectory })

      const initialResult = await firstTool.execute({ name: "initial-skill" }, mockContext)

      fs.mkdirSync(secondSkillDirectory, { recursive: true })
      fs.writeFileSync(join(secondSkillDirectory, "SKILL.md"), "---\ndescription: Second skill\n---\nSecond skill body")

      const cachedTool = createSkillTool({ directory: temporaryDirectory })

      expect(initialResult).toContain("Skill: initial-skill")
      let cachedError: Error | undefined
      try {
        await cachedTool.execute({ name: "second-skill" }, mockContext)
      } catch (error) {
        cachedError = error instanceof Error ? error : new Error(String(error))
      }
      expect(cachedError?.message).toContain('Skill or command "second-skill" not found.')
    } finally {
      process.chdir(originalDirectory)
      clearSkillCache()
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it("merges pre-provided skills with dynamically discovered ones", async () => {
    const syntheticSkill = createMockSkill("synthetic-only")
    const tool = createSkillTool({ skills: [syntheticSkill] })

    const result = await tool.execute({ name: "synthetic-only" }, mockContext)

    expect(result).toContain("Skill: synthetic-only")
  })

  it("prefers disk-discovered skills over pre-provided ones", async () => {
    const overrideSkill = createMockSkill("playwright")
    overrideSkill.definition.description = "SHOULD_BE_OVERRIDDEN"
    const tool = createSkillTool({ skills: [overrideSkill] })

    const result = await tool.execute({ name: "playwright" }, mockContext)

    expect(result).not.toContain("SHOULD_BE_OVERRIDDEN")
  })
})

describe("skill tool - dynamic description cache invalidation", () => {
  it("keeps description available after execute misses a skill", async () => {
    const tool = createSkillTool({})

    const initialDescription = tool.description
    expect(initialDescription).toBeString()

    await expect(tool.execute({ name: "nonexistent-skill-12345" }, mockContext)).rejects.toThrow(
      'Skill or command "nonexistent-skill-12345" not found',
    )

    expect(tool.description).toBeDefined()
    expect(typeof tool.description).toBe("string")
  })

  it("picks up new disk skills only after the shared skill cache resets", async () => {
    clearSkillCache()
    const originalDirectory = process.cwd()
    const temporaryDirectory = fs.mkdtempSync(join(tmpdir(), "skill-tool-refresh-"))
    const initialSkillDirectory = join(temporaryDirectory, ".opencode", "skills", "initial-skill")
    const secondSkillDirectory = join(temporaryDirectory, ".opencode", "skills", "second-skill")

    fs.mkdirSync(initialSkillDirectory, { recursive: true })
    fs.writeFileSync(join(initialSkillDirectory, "SKILL.md"), "---\ndescription: Initial skill\n---\nInitial skill body")
    process.chdir(temporaryDirectory)

    try {
      const initialTool = createSkillTool({ directory: temporaryDirectory })
      await initialTool.execute({ name: "initial-skill" }, mockContext)

      fs.mkdirSync(secondSkillDirectory, { recursive: true })
      fs.writeFileSync(join(secondSkillDirectory, "SKILL.md"), "---\ndescription: Second skill\n---\nSecond skill body")

      const cachedTool = createSkillTool({ directory: temporaryDirectory })
      let cachedError: Error | undefined
      try {
        await cachedTool.execute({ name: "second-skill" }, mockContext)
      } catch (error) {
        cachedError = error instanceof Error ? error : new Error(String(error))
      }
      expect(cachedError?.message).toContain('Skill or command "second-skill" not found.')

      clearSkillCache()
      const refreshedTool = createSkillTool({
        directory: temporaryDirectory,
        includeSkillsInDescription: true,
      })

      const refreshedResult = await refreshedTool.execute({ name: "second-skill" }, mockContext)

      expect(refreshedResult).toContain("Skill: second-skill")
      expect(refreshedTool.description).toContain("second-skill")
    } finally {
      process.chdir(originalDirectory)
      clearSkillCache()
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})
