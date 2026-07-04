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

  describe("discoverSkillsInDirAsync MCP configs", () => {

    it("loads MCP config from frontmatter", async () => {
      // given
      const skillContent = `---
name: mcp-skill
description: Skill with MCP
mcp:
  sqlite:
    command: uvx
    args: [mcp-server-sqlite]
---
MCP skill.
`
      createTestSkill("mcp-skill", skillContent)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      const skill = skills.find((s: LoadedSkill) => s.name === "mcp-skill")
      expect(skill?.mcpConfig).toBeDefined()
      expect(skill?.mcpConfig?.sqlite).toBeDefined()
      expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
    })

    it("loads MCP config from mcp.json file", async () => {
      // given
      const skillContent = `---
name: json-mcp-skill
description: Skill with mcp.json
---
Skill body.
`
      const mcpJson = {
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["@playwright/mcp"]
          }
        }
      }
      createTestSkill("json-mcp-skill", skillContent, mcpJson)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then
      const skill = skills.find((s: LoadedSkill) => s.name === "json-mcp-skill")
      expect(skill?.mcpConfig?.playwright).toBeDefined()
      expect(skill?.mcpConfig?.playwright?.command).toBe("npx")
    })

    it("prioritizes mcp.json over frontmatter MCP", async () => {
      // given
      const skillContent = `---
name: priority-test
mcp:
  from-yaml:
    command: yaml-cmd
---
Skill.
`
      const mcpJson = {
        mcpServers: {
          "from-json": {
            command: "json-cmd"
          }
        }
      }
      createTestSkill("priority-test", skillContent, mcpJson)

      // when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // then - mcp.json should take priority
      const skill = skills.find((s: LoadedSkill) => s.name === "priority-test")
      expect(skill?.mcpConfig?.["from-json"]).toBeDefined()
      expect(skill?.mcpConfig?.["from-yaml"]).toBeUndefined()
    })
  })
})
