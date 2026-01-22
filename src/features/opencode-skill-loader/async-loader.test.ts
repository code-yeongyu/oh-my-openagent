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
      // #given - non-existent directory
      const nonExistentDir = join(TEST_DIR, "does-not-exist")

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(nonExistentDir)

      // #then - should return empty array, not throw
      expect(skills).toEqual([])
    })

    it("discovers skills from SKILL.md in directory", async () => {
      // #given
      const skillContent = `---
name: test-skill
description: A test skill
---
This is the skill body.
`
      createTestSkill("test-skill", skillContent)

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("test-skill")
      expect(skills[0].definition.description).toContain("A test skill")
    })

    it("discovers skills from {name}.md pattern in directory", async () => {
      // #given
      const skillContent = `---
name: named-skill
description: Named pattern skill
---
Skill body.
`
      const skillDir = join(SKILLS_DIR, "named-skill")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, "named-skill.md"), skillContent)

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("named-skill")
    })

    it("discovers direct .md files", async () => {
      // #given
      const skillContent = `---
name: direct-skill
description: Direct markdown file
---
Direct skill.
`
      createDirectSkill("direct-skill", skillContent)

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("direct-skill")
    })

    it("skips entries starting with dot", async () => {
      // #given
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then - only valid-skill should be discovered
      expect(skills).toHaveLength(1)
      expect(skills[0]?.name).toBe("valid-skill")
    })

    it("skips invalid files and continues with valid ones", async () => {
      // #given - one valid, one invalid (unreadable)
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then - should skip invalid and return only valid
      expect(skills.length).toBeGreaterThanOrEqual(1)
      expect(skills.some((s: LoadedSkill) => s.name === "valid-skill")).toBe(true)

      // Cleanup: restore permissions before cleanup
      if (process.platform !== "win32") {
        chmodSync(invalidFile, 0o644)
      }
    })

    it("discovers multiple skills correctly", async () => {
      // #given
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const asyncSkills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      expect(asyncSkills.length).toBe(2)
      expect(asyncSkills.map((s: LoadedSkill) => s.name).sort()).toEqual(["skill-one", "skill-two"])
      
      const skill1Result = asyncSkills.find((s: LoadedSkill) => s.name === "skill-one")
      expect(skill1Result?.definition.description).toContain("First skill")
    })

    it("loads MCP config from frontmatter", async () => {
      // #given
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      const skill = skills.find((s: LoadedSkill) => s.name === "mcp-skill")
      expect(skill?.mcpConfig).toBeDefined()
      expect(skill?.mcpConfig?.sqlite).toBeDefined()
      expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
    })

    it("loads MCP config from mcp.json file", async () => {
      // #given
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then
      const skill = skills.find((s: LoadedSkill) => s.name === "json-mcp-skill")
      expect(skill?.mcpConfig?.playwright).toBeDefined()
      expect(skill?.mcpConfig?.playwright?.command).toBe("npx")
    })

    it("prioritizes mcp.json over frontmatter MCP", async () => {
      // #given
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

      // #when
      const { discoverSkillsInDirAsync } = await import("./async-loader")
      const skills = await discoverSkillsInDirAsync(SKILLS_DIR)

      // #then - mcp.json should take priority
      const skill = skills.find((s: LoadedSkill) => s.name === "priority-test")
      expect(skill?.mcpConfig?.["from-json"]).toBeDefined()
      expect(skill?.mcpConfig?.["from-yaml"]).toBeUndefined()
    })
  })

  describe("mapWithConcurrency", () => {
    it("processes items with concurrency limit", async () => {
      // #given
      const { mapWithConcurrency } = await import("./async-loader")
      const items = Array.from({ length: 50 }, (_, i) => i)
      let maxConcurrent = 0
      let currentConcurrent = 0

      const mapper = async (item: number) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        await new Promise(resolve => setTimeout(resolve, 10))
        currentConcurrent--
        return item * 2
      }

      // #when
      const results = await mapWithConcurrency(items, mapper, 16)

      // #then
      expect(results).toEqual(items.map(i => i * 2))
      expect(maxConcurrent).toBeLessThanOrEqual(16)
      expect(maxConcurrent).toBeGreaterThan(1) // Should actually run concurrently
    })

    it("handles empty array", async () => {
      // #given
      const { mapWithConcurrency } = await import("./async-loader")

      // #when
      const results = await mapWithConcurrency([], async (x: number) => x * 2, 16)

      // #then
      expect(results).toEqual([])
    })

    it("handles single item", async () => {
      // #given
      const { mapWithConcurrency } = await import("./async-loader")

      // #when
      const results = await mapWithConcurrency([42], async (x: number) => x * 2, 16)

      // #then
      expect(results).toEqual([84])
    })
  })

  describe("loadSkillFromPathAsync", () => {
    it("loads skill from valid path", async () => {
      // #given
      const skillContent = `---
name: path-skill
description: Loaded from path
---
Path skill.
`
      const skillDir = createTestSkill("path-skill", skillContent)
      const skillPath = join(skillDir, "SKILL.md")

      // #when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(skillPath, skillDir, "path-skill", "opencode-project")

      // #then
      expect(skill).not.toBeNull()
      expect(skill?.name).toBe("path-skill")
      expect(skill?.scope).toBe("opencode-project")
    })

    it("returns null for invalid path", async () => {
      // #given
      const invalidPath = join(TEST_DIR, "nonexistent.md")

      // #when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(invalidPath, TEST_DIR, "invalid", "opencode")

      // #then
      expect(skill).toBeNull()
    })

    it("returns null for malformed skill file", async () => {
      // #given
      const malformedContent = "This is not valid frontmatter content\nNo YAML here!"
      mkdirSync(SKILLS_DIR, { recursive: true })
      const malformedPath = join(SKILLS_DIR, "malformed.md")
      writeFileSync(malformedPath, malformedContent)

      // #when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(malformedPath, SKILLS_DIR, "malformed", "user")

      // #then
      expect(skill).not.toBeNull() // parseFrontmatter handles missing frontmatter gracefully
    })
  })

  describe("loadMcpJsonFromDirAsync", () => {
    it("loads mcp.json with mcpServers format", async () => {
      // #given
      mkdirSync(SKILLS_DIR, { recursive: true })
      const mcpJson = {
        mcpServers: {
          test: {
            command: "test-cmd",
            args: ["arg1"]
          }
        }
      }
      writeFileSync(join(SKILLS_DIR, "mcp.json"), JSON.stringify(mcpJson))

      // #when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // #then
      expect(config).toBeDefined()
      expect(config?.test).toBeDefined()
      expect(config?.test?.command).toBe("test-cmd")
    })

    it("returns undefined for non-existent mcp.json", async () => {
      // #given
      mkdirSync(SKILLS_DIR, { recursive: true })

      // #when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // #then
      expect(config).toBeUndefined()
    })

    it("returns undefined for invalid JSON", async () => {
      // #given
      mkdirSync(SKILLS_DIR, { recursive: true })
      writeFileSync(join(SKILLS_DIR, "mcp.json"), "{ invalid json }")

      // #when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // #then
      expect(config).toBeUndefined()
    })

    it("supports direct format without mcpServers", async () => {
      // #given
      mkdirSync(SKILLS_DIR, { recursive: true })
      const mcpJson = {
        direct: {
          command: "direct-cmd",
          args: ["arg"]
        }
      }
      writeFileSync(join(SKILLS_DIR, "mcp.json"), JSON.stringify(mcpJson))

      // #when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // #then
      expect(config?.direct).toBeDefined()
      expect(config?.direct?.command).toBe("direct-cmd")
    })
  })
})
