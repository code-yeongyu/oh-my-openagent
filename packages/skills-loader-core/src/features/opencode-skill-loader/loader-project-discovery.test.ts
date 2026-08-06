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

  describe("agents skills discovery (.agents/skills/)", () => {
    it("#given a skill in .agents/skills/ #when discoverProjectAgentsSkills is called #then it discovers the skill", async () => {
      //#given
      const skillContent = `---
name: agent-project-skill
description: A skill from project .agents/skills directory
---
Skill body.
`
      const agentsProjectSkillsDir = join(TEST_DIR, ".agents", "skills")
      const skillDir = join(agentsProjectSkillsDir, "agent-project-skill")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, "SKILL.md"), skillContent)

      //#when
      const { discoverProjectAgentsSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverProjectAgentsSkills()
        const skill = skills.find(s => s.name === "agent-project-skill")

        //#then
        expect(skill).toBeDefined()
        expect(skill?.scope).toBe("project")
        expect(skill?.definition.description).toContain("A skill from project .agents/skills directory")
      } finally {
        process.chdir(originalCwd)
      }
    })

    it("#given a skill in .agents/skills/ #when discoverProjectAgentsSkills is called with directory #then it discovers the skill", async () => {
      //#given
      const skillContent = `---
name: agent-dir-skill
description: A skill via explicit directory param
---
Skill body.
`
      const agentsProjectSkillsDir = join(TEST_DIR, ".agents", "skills")
      const skillDir = join(agentsProjectSkillsDir, "agent-dir-skill")
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, "SKILL.md"), skillContent)

      //#when
      const { discoverProjectAgentsSkills } = await import("./loader")
      const skills = await discoverProjectAgentsSkills(TEST_DIR)
      const skill = skills.find(s => s.name === "agent-dir-skill")

      //#then
      expect(skill).toBeDefined()
      expect(skill?.scope).toBe("project")
    })

    it("#given a skill in ancestor .agents/skills/ #when discoverProjectAgentsSkills is called from child directory #then it discovers the ancestor skill", async () => {
      // given
      const skillContent = `---
name: ancestor-agent-skill
description: A skill from ancestor .agents/skills directory
---
Skill body.
`
      const projectDir = join(TEST_DIR, "project")
      const childDir = join(projectDir, "apps", "worker")
      const agentsProjectSkillsDir = join(projectDir, ".agents", "skills")
      const skillDir = join(agentsProjectSkillsDir, "ancestor-agent-skill")
      mkdirSync(childDir, { recursive: true })
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, "SKILL.md"), skillContent)

      // when
      const { discoverProjectAgentsSkills } = await import("./loader")
      const skills = await discoverProjectAgentsSkills(childDir)
      const skill = skills.find((candidate) => candidate.name === "ancestor-agent-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.scope).toBe("project")
    })
  })

  describe("opencode project skill discovery", () => {
    it("#given a skill in ancestor .opencode/skills/ #when discoverOpencodeProjectSkills is called from child directory #then it discovers the ancestor skill", async () => {
      // given
      const skillContent = `---
name: ancestor-opencode-skill
description: A skill from ancestor .opencode/skills directory
---
Skill body.
`
      const projectDir = join(TEST_DIR, "project")
      const childDir = join(projectDir, "packages", "cli")
      const skillsDir = join(projectDir, ".opencode", "skills", "ancestor-opencode-skill")
      mkdirSync(childDir, { recursive: true })
      mkdirSync(skillsDir, { recursive: true })
      writeFileSync(join(skillsDir, "SKILL.md"), skillContent)

      // when
      const { discoverOpencodeProjectSkills } = await import("./loader")
      const skills = await discoverOpencodeProjectSkills(childDir)
      const skill = skills.find((candidate) => candidate.name === "ancestor-opencode-skill")

      // then
      expect(skill).toBeDefined()
      expect(skill?.scope).toBe("opencode-project")
    })

    it("#given a skill in .opencode/skill/ #when discoverOpencodeProjectSkills is called #then it discovers the singular alias directory", async () => {
      // given
      const skillContent = `---
name: singular-opencode-skill
description: A skill from .opencode/skill directory
---
Skill body.
`
      const singularSkillDir = join(
        TEST_DIR,
        ".opencode",
        "skill",
        "singular-opencode-skill",
      )
      mkdirSync(singularSkillDir, { recursive: true })
      writeFileSync(join(singularSkillDir, "SKILL.md"), skillContent)

      // when
      const { discoverOpencodeProjectSkills } = await import("./loader")
      const originalCwd = process.cwd()
      process.chdir(TEST_DIR)

      try {
        const skills = await discoverOpencodeProjectSkills()
        const skill = skills.find((candidate) => candidate.name === "singular-opencode-skill")

        // then
        expect(skill).toBeDefined()
        expect(skill?.scope).toBe("opencode-project")
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
