import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "skill-loader-test-" + Date.now())
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

describe("skill loader MCP parsing", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe("deduplication", () => {
    it("deduplicates skills by name across scopes, keeping higher priority (opencode-project > opencode > project)", async () => {
      const originalCwd = process.cwd()
      const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

      // given: same skill name in multiple scopes
      const opencodeProjectSkillsDir = join(TEST_DIR, ".opencode", "skills")
      const opencodeConfigDir = join(TEST_DIR, "opencode-global")
      const opencodeGlobalSkillsDir = join(opencodeConfigDir, "skills")
      const projectClaudeSkillsDir = join(TEST_DIR, ".claude", "skills")

      process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir
      process.env.CLAUDE_CONFIG_DIR = join(TEST_DIR, "claude-user")

      mkdirSync(join(opencodeProjectSkillsDir, "duplicate-skill"), { recursive: true })
      mkdirSync(join(opencodeGlobalSkillsDir, "duplicate-skill"), { recursive: true })
      mkdirSync(join(projectClaudeSkillsDir, "duplicate-skill"), { recursive: true })

      writeFileSync(
        join(opencodeProjectSkillsDir, "duplicate-skill", "SKILL.md"),
        `---
name: duplicate-skill
description: From opencode-project (highest priority)
---
opencode-project body.
`
      )

      writeFileSync(
        join(opencodeGlobalSkillsDir, "duplicate-skill", "SKILL.md"),
        `---
name: duplicate-skill
description: From opencode-global (middle priority)
---
opencode-global body.
`
      )

      writeFileSync(
        join(projectClaudeSkillsDir, "duplicate-skill", "SKILL.md"),
        `---
name: duplicate-skill
description: From claude project (lowest priority among these)
---
claude project body.
`
      )

      // when
      const { discoverSkills } = await import("./loader")
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills()
        const duplicates = skills.filter(s => s.name === "duplicate-skill")

        // then
        expect(duplicates).toHaveLength(1)
        expect(duplicates[0]?.scope).toBe("opencode-project")
        expect(duplicates[0]?.definition.description).toContain("opencode-project")
      } finally {
        process.chdir(originalCwd)
        if (originalOpenCodeConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
        }
        if (originalClaudeConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR
        } else {
          process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
        }
      }
    })

    it("prioritizes OpenCode global skills over legacy Claude project skills", async () => {
      const originalCwd = process.cwd()
      const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
      const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

      const opencodeConfigDir = join(TEST_DIR, "opencode-global")
      const opencodeGlobalSkillsDir = join(opencodeConfigDir, "skills")
      const projectClaudeSkillsDir = join(TEST_DIR, ".claude", "skills")

      process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir
      process.env.CLAUDE_CONFIG_DIR = join(TEST_DIR, "claude-user")

      mkdirSync(join(opencodeGlobalSkillsDir, "global-over-project"), { recursive: true })
      mkdirSync(join(projectClaudeSkillsDir, "global-over-project"), { recursive: true })

      writeFileSync(
        join(opencodeGlobalSkillsDir, "global-over-project", "SKILL.md"),
        `---
name: global-over-project
description: From opencode-global (should win)
---
opencode-global body.
`
      )

      writeFileSync(
        join(projectClaudeSkillsDir, "global-over-project", "SKILL.md"),
        `---
name: global-over-project
description: From claude project (should lose)
---
claude project body.
`
      )

      const { discoverSkills } = await import("./loader")
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills()
        const matches = skills.filter(s => s.name === "global-over-project")

        expect(matches).toHaveLength(1)
        expect(matches[0]?.scope).toBe("opencode")
        expect(matches[0]?.definition.description).toContain("opencode-global")
      } finally {
        process.chdir(originalCwd)
        if (originalOpenCodeConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
        }
        if (originalClaudeConfigDir === undefined) {
          delete process.env.CLAUDE_CONFIG_DIR
        } else {
          process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
        }
      }
    })

    it("returns no duplicates from discoverSkills", async () => {
      const originalCwd = process.cwd()
      const originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR

      process.env.OPENCODE_CONFIG_DIR = join(TEST_DIR, "opencode-global")

      // given
      const skillContent = `---
name: unique-test-skill
description: A unique skill for dedup test
---
Skill body.
`
      createTestSkill("unique-test-skill", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })

        // then
        const names = skills.map(s => s.name)
        const uniqueNames = [...new Set(names)]
        expect(names.length).toBe(uniqueNames.length)
      } finally {
        process.chdir(originalCwd)
         if (originalOpenCodeConfigDir === undefined) {
          delete process.env.OPENCODE_CONFIG_DIR
        } else {
          process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
        }
      }
    })
  })
})
