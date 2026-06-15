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

  describe("getSkillByName", () => {
    it("#given a discoverable skill #when getSkillByName is called with the exact full name #then it returns the skill", async () => {
      // given - a skill with a plain (non-namespaced) name
      const skillContent = `---
name: my-exact-skill
description: A skill resolvable by exact name
---
Body.
`
      createTestSkill("my-exact-skill", skillContent)

      // when
      const { getSkillByName } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skill = await getSkillByName("my-exact-skill", { includeClaudeCodePaths: false })

        // then
        expect(skill).toBeDefined()
        expect(skill?.name).toBe("my-exact-skill")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("#given a namespaced skill #when getSkillByName is called with its unique short name #then it returns the skill", async () => {
      // given - a namespaced skill that is the unique short-name match
      const skillContent = `---
name: toolkit/systematic-debugging
description: Namespaced skill the agent should be able to load by short name
---
Body.
`
      createTestSkill("systematic-debugging", skillContent)

      // when
      const { getSkillByName } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skill = await getSkillByName("systematic-debugging", { includeClaudeCodePaths: false })

        // then - the short-name lookup must succeed, mirroring matchSkillByName semantics
        expect(skill).toBeDefined()
        expect(skill?.name).toBe("toolkit/systematic-debugging")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("#given two namespaced skills sharing a short name #when getSkillByName is called with that short name #then it returns undefined (ambiguous)", async () => {
      // given - two skills under different namespaces with the same short name
      const skillA = `---
name: alpha/duplicated
description: Skill A
---
Body A.
`
      const skillB = `---
name: beta/duplicated
description: Skill B
---
Body B.
`
      createTestSkill("alpha-duplicated", skillA)
      createTestSkill("beta-duplicated", skillB)

      // when
      const { getSkillByName } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skill = await getSkillByName("duplicated", { includeClaudeCodePaths: false })

        // then - ambiguous short-name match must NOT resolve, matching matchSkillByName behavior
        expect(skill).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
