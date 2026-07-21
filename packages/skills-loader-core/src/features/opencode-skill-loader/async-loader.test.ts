import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { LoadedSkill } from "./types"

const TEST_DIR = join(tmpdir(), "async-loader-test-" + Date.now())
const SKILLS_DIR = join(TEST_DIR, ".opencode", "skills")

function createTestSkill(name: string, content: string, mcpJson?: object): string {
  const skillDir = join(SKILLS_DIR, name)
  mkdirSync(skillDir, { recursive: true })
  const skillPath = join(skillDir, "SKILL.md")
  writeFileSync(skillPath, content)
  if (mcpJson) {
    writeFileSync(join(skillDir, "mcp.json"), JSON.stringify(mcpJson, null, 2))
  }
  return skillDir
}

function createDirectSkill(name: string, content: string): string {
  mkdirSync(SKILLS_DIR, { recursive: true })
  const skillPath = join(SKILLS_DIR, `${name}.md`)
  writeFileSync(skillPath, content)
  return skillPath
}

describe("async-loader", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("discoverSkillsInDirAsync", () => {
    it("returns empty array for non-existent directory", async () => {
      // given - non-existent directory
      const nonExistentDir = join(TEST_DIR, "does-not-exist")

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(nonExistentDir)

      // then - should return empty array, not throw
      expect(skills).toEqual([])
    })

    it("discovers skills from SKILL.md in directory", async () => {
      // given
      const skillContent = `---
name: test-skill
description: A test skill
---
This is the skill body.
`
      createTestSkill("test-skill", skillContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("test-skill")
      expect(skills[0].definition.description).toContain("A test skill")
    })

    it("discovers skills from {name}.md pattern in directory", async () => {
      // given
      const skillContent = `---
name: named-skill
description: Named pattern skill
---
Skill body.
`
      const skillDir = join(SKILLS_DIR, "named-skill")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, "named-skill.md"), skillContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("named-skill")
    })

    it("discovers direct .md files", async () => {
      // given
      const skillContent = `---
name: direct-skill
description: Direct markdown file
---
Direct skill.
`
      createDirectSkill("direct-skill", skillContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("direct-skill")
    })

    it("parses allowed-tools through the shared parser", async () => {
      // given
      const skillContent = `---
name: allowed-tools-skill
description: Skill with allowed tools
allowed-tools:
  - Read
  - " Write "
  - ""
  - Bash
---
Skill body.
`
      createTestSkill("allowed-tools-skill", skillContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0]?.allowedTools).toEqual(["Read", "Write", "Bash"])
    })

    it("preserves nested skill path names during recursive discovery", async () => {
      // given
      const nestedSkillDir = join(SKILLS_DIR, "superpowers", "brainstorming")
      mkdirSync(nestedSkillDir, { recursive: true })
      writeFileSync(
        join(nestedSkillDir, "SKILL.md"),
        `---
name: brainstorming
description: Nested brainstorming skill
---
Nested skill.
`
      )

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0]?.name).toBe("superpowers/brainstorming")
      expect(skills[0]?.definition.name).toBe("superpowers/brainstorming")
    })

    it("preserves nested skill path names for nested {dirName}.md discovery", async () => {
      // given
      const nestedSkillDir = join(SKILLS_DIR, "superpowers", "brainstorming")
      mkdirSync(nestedSkillDir, { recursive: true })
      writeFileSync(
        join(nestedSkillDir, "brainstorming.md"),
        `---
name: brainstorming
description: Nested brainstorming skill
---
Nested skill.
`
      )

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0]?.name).toBe("superpowers/brainstorming")
      expect(skills[0]?.definition.name).toBe("superpowers/brainstorming")
    })

    it("preserves nested skill path names for nested direct markdown discovery", async () => {
      // given
      const nestedSkillDir = join(SKILLS_DIR, "superpowers")
      mkdirSync(nestedSkillDir, { recursive: true })
      writeFileSync(
        join(nestedSkillDir, "brainstorming.md"),
        `---
name: brainstorming
description: Nested brainstorming skill
---
Nested skill.
`
      )

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(skills).toHaveLength(1)
      expect(skills[0]?.name).toBe("superpowers/brainstorming")
      expect(skills[0]?.definition.name).toBe("superpowers/brainstorming")
    })

    it("skips entries starting with dot", async () => {
      // given
      const validContent = `---
name: valid-skill
---
Valid.
`
      const hiddenContent = `---
name: hidden-skill
---
Hidden.
`
      createTestSkill("valid-skill", validContent)
      createTestSkill(".hidden-skill", hiddenContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then - only valid-skill should be discovered
      expect(skills).toHaveLength(1)
      expect(skills[0]?.name).toBe("valid-skill")
    })

    it("skips invalid files and continues with valid ones", async () => {
      // given - one valid, one invalid (unreadable)
      const validContent = `---
name: valid-skill
---
Valid skill.
`
      const invalidContent = `---
name: invalid-skill
---
Invalid skill.
`
      createTestSkill("valid-skill", validContent)
      const invalidDir = createTestSkill("invalid-skill", invalidContent)
      const invalidFile = join(invalidDir, "SKILL.md")

      // Make file unreadable on Unix systems
      if (process.platform !== "win32") {
        chmodSync(invalidFile, 0o000)
      }

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then - should skip invalid and return only valid
      expect(skills.length).toBeGreaterThanOrEqual(1)
      expect(skills.some((s: LoadedSkill) => s.name === "valid-skill")).toBe(true)

      // Cleanup: restore permissions before cleanup
      if (process.platform !== "win32") {
        chmodSync(invalidFile, 0o644)
      }
    })

    it("discovers multiple skills correctly", async () => {
      // given
      const skill1 = `---
name: skill-one
description: First skill
---
Skill one.
`
      const skill2 = `---
name: skill-two
description: Second skill
---
Skill two.
`
      createTestSkill("skill-one", skill1)
      createTestSkill("skill-two", skill2)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const asyncSkills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      expect(asyncSkills.length).toBe(2)
      expect(asyncSkills.map((s: LoadedSkill) => s.name).sort()).toEqual(["skill-one", "skill-two"])

      const skill1Result = asyncSkills.find((s: LoadedSkill) => s.name === "skill-one")
      expect(skill1Result?.definition.description).toContain("First skill")
    })
  })
})
