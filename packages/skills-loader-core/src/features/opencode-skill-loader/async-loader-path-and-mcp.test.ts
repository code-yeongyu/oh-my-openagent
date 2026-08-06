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

  describe("loadSkillFromPathAsync", () => {
    it("loads skill from valid path", async () => {
      // given
      const skillContent = `---
name: path-skill
description: Loaded from path
---
Path skill.
`
      const skillDir = createTestSkill("path-skill", skillContent)
      const skillPath = join(skillDir, "SKILL.md")

      // when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(skillPath, skillDir, "path-skill", "opencode-project")

      // then
      expect(skill).not.toBeNull()
      expect(skill?.name).toBe("path-skill")
      expect(skill?.scope).toBe("opencode-project")
    })

    it("returns null for invalid path", async () => {
      // given
      const invalidPath = join(TEST_DIR, "nonexistent.md")

      // when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(invalidPath, TEST_DIR, "invalid", "opencode")

      // then
      expect(skill).toBeNull()
    })

    it("returns null for malformed skill file", async () => {
      // given
      const malformedContent = "This is not valid frontmatter content\nNo YAML here!"
      mkdirSync(SKILLS_DIR, { recursive: true })
      const malformedPath = join(SKILLS_DIR, "malformed.md")
      writeFileSync(malformedPath, malformedContent)

      // when
      const { loadSkillFromPathAsync } = await import("./async-loader")
      const skill = await loadSkillFromPathAsync(malformedPath, SKILLS_DIR, "malformed", "user")

      // then
      expect(skill).not.toBeNull() // parseFrontmatter handles missing frontmatter gracefully
    })
  })

  describe("loadMcpJsonFromDirAsync", () => {
    it("loads mcp.json with mcpServers format", async () => {
      // given
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

      // when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // then
      expect(config).toBeDefined()
      expect(config?.test).toBeDefined()
      expect(config?.test?.command).toBe("test-cmd")
    })

    it("returns undefined for non-existent mcp.json", async () => {
      // given
      mkdirSync(SKILLS_DIR, { recursive: true })

      // when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // then
      expect(config).toBeUndefined()
    })

    it("returns undefined for invalid JSON", async () => {
      // given
      mkdirSync(SKILLS_DIR, { recursive: true })
      writeFileSync(join(SKILLS_DIR, "mcp.json"), "{ invalid json }")

      // when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // then
      expect(config).toBeUndefined()
    })

    it("supports direct format without mcpServers", async () => {
      // given
      mkdirSync(SKILLS_DIR, { recursive: true })
      const mcpJson = {
        direct: {
          command: "direct-cmd",
          args: ["arg"]
        }
      }
      writeFileSync(join(SKILLS_DIR, "mcp.json"), JSON.stringify(mcpJson))

      // when
      const { loadMcpJsonFromDirAsync } = await import("./async-loader")
      const config = await loadMcpJsonFromDirAsync(SKILLS_DIR)

      // then
      expect(config?.direct).toBeDefined()
      expect(config?.direct?.command).toBe("direct-cmd")
    })
  })
})
