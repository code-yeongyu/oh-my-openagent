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

  describe("parseSkillMcpConfig", () => {
    it("parses skill with nested MCP config", async () => {
      // given
      const skillContent = `---
name: test-skill
description: A test skill with MCP
mcp:
  sqlite:
    command: uvx
    args:
      - mcp-server-sqlite
      - --db-path
      - ./data.db
  memory:
    command: npx
    args: [-y, "@anthropic-ai/mcp-server-memory"]
---
This is the skill body.
`
      createTestSkill("test-mcp-skill", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "test-skill")

        // then
        expect(skill).toBeDefined()
        expect(skill?.mcpConfig).toBeDefined()
        expect(skill?.mcpConfig?.sqlite).toBeDefined()
        expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
        expect(skill?.mcpConfig?.sqlite?.args).toEqual([
          "mcp-server-sqlite",
          "--db-path",
          "./data.db"
        ])
        expect(skill?.mcpConfig?.memory).toBeDefined()
        expect(skill?.mcpConfig?.memory?.command).toBe("npx")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("returns undefined mcpConfig for skill without MCP", async () => {
      // given
      const skillContent = `---
name: simple-skill
description: A simple skill without MCP
---
This is a simple skill.
`
      createTestSkill("simple-skill", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "simple-skill")

        // then
        expect(skill).toBeDefined()
        expect(skill?.mcpConfig).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("preserves env var placeholders without expansion", async () => {
      // given
      const skillContent = `---
name: env-skill
mcp:
  api-server:
    command: node
    args: [server.js]
    env:
      API_KEY: "\${API_KEY}"
      DB_PATH: "\${HOME}/data.db"
---
Skill with env vars.
`
      createTestSkill("env-skill", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "env-skill")

        // then
        expect(skill?.mcpConfig?.["api-server"]?.env?.API_KEY).toBe("${API_KEY}")
        expect(skill?.mcpConfig?.["api-server"]?.env?.DB_PATH).toBe("${HOME}/data.db")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("handles malformed YAML gracefully", async () => {
      // given - malformed YAML causes entire frontmatter to fail parsing
      const skillContent = `---
name: bad-yaml
mcp: [this is not valid yaml for mcp
---
Skill body.
`
      createTestSkill("bad-yaml-skill", skillContent)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        // then - when YAML fails, skill uses directory name as fallback
        const skill = skills.find(s => s.name === "bad-yaml-skill")

        expect(skill).toBeDefined()
        expect(skill?.mcpConfig).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  describe("mcp.json file loading (AmpCode compat)", () => {
    it("loads MCP config from mcp.json with mcpServers format", async () => {
      // given
      const skillContent = `---
name: ampcode-skill
description: Skill with mcp.json
---
Skill body.
`
      const mcpJson = {
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["@playwright/mcp@latest"]
          }
        }
      }
      createTestSkill("ampcode-skill", skillContent, mcpJson)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "ampcode-skill")

        // then
        expect(skill).toBeDefined()
        expect(skill?.mcpConfig).toBeDefined()
        expect(skill?.mcpConfig?.playwright).toBeDefined()
        expect(skill?.mcpConfig?.playwright?.command).toBe("npx")
        expect(skill?.mcpConfig?.playwright?.args).toEqual(["@playwright/mcp@latest"])
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("mcp.json takes priority over YAML frontmatter", async () => {
      // given
      const skillContent = `---
name: priority-skill
mcp:
  from-yaml:
    command: yaml-cmd
    args: [yaml-arg]
---
Skill body.
`
      const mcpJson = {
        mcpServers: {
          "from-json": {
            command: "json-cmd",
            args: ["json-arg"]
          }
        }
      }
      createTestSkill("priority-skill", skillContent, mcpJson)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "priority-skill")

        // then - mcp.json should take priority
        expect(skill?.mcpConfig?.["from-json"]).toBeDefined()
        expect(skill?.mcpConfig?.["from-yaml"]).toBeUndefined()
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("supports direct format without mcpServers wrapper", async () => {
      // given
      const skillContent = `---
name: direct-format
---
Skill body.
`
      const mcpJson = {
        sqlite: {
          command: "uvx",
          args: ["mcp-server-sqlite"]
        }
      }
      createTestSkill("direct-format", skillContent, mcpJson)

      // when
      const { discoverSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverSkills({ includeClaudeCodePaths: false })
        const skill = skills.find(s => s.name === "direct-format")

        // then
        expect(skill?.mcpConfig?.sqlite).toBeDefined()
        expect(skill?.mcpConfig?.sqlite?.command).toBe("uvx")
      } finally {
        process.chdir(originalCwd)
      }
      })
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
