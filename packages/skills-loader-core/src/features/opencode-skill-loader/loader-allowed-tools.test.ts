import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// mkdtempSync, never a clock-derived name: consecutive Date.now() calls in one process
// return the same millisecond, so sibling suites sharing this prefix collided on one
// directory and each teardown removed the other's live fixture. On Windows, removing an
// in-use tree blocks until the hook budget expires ("a beforeEach/afterEach hook timed out").
let TEST_DIR = ""
let SKILLS_DIR = ""

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

describe("skill loader MCP parsing", () => {
  beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), "skill-loader-test-"))
    SKILLS_DIR = join(TEST_DIR, ".opencode", "skills")
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("allowed-tools parsing", () => {
    it("parses space-separated allowed-tools string", async () => {
      // given
      const skillContent = `---
name: space-separated-tools
description: Skill with space-separated allowed-tools
allowed-tools: Read Write Edit Bash
---
Skill body.
`
      createTestSkill("space-separated-tools", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "space-separated-tools")

        // then
        expect(skill).toBeDefined()
        expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("parses YAML inline array allowed-tools", async () => {
      // given
      const skillContent = `---
name: yaml-inline-array
description: Skill with YAML inline array allowed-tools
allowed-tools: [Read, Write, Edit, Bash]
---
Skill body.
`
      createTestSkill("yaml-inline-array", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "yaml-inline-array")

        // then
        expect(skill).toBeDefined()
        expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("parses YAML multi-line array allowed-tools", async () => {
      // given
      const skillContent = `---
name: yaml-multiline-array
description: Skill with YAML multi-line array allowed-tools
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---
Skill body.
`
      createTestSkill("yaml-multiline-array", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "yaml-multiline-array")

        // then
        expect(skill).toBeDefined()
        expect(skill?.allowedTools).toEqual(["Read", "Write", "Edit", "Bash"])
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("returns undefined for skill without allowed-tools", async () => {
      // given
      const skillContent = `---
name: no-allowed-tools
description: Skill without allowed-tools field
---
Skill body.
`
      createTestSkill("no-allowed-tools", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "no-allowed-tools")

        // then
        expect(skill).toBeDefined()
        expect(skill?.allowedTools).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
