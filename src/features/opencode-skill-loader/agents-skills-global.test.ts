import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "agents-global-skills-test-" + Date.now())
const TEMP_HOME = join(TEST_DIR, "home")

describe("discoverGlobalAgentsSkills", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEMP_HOME, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given a skill in ~/.agents/skills/ #when discoverGlobalAgentsSkills is called #then it discovers the skill", async () => {
    //#given
    const skillContent = `---
name: agent-global-skill
description: A skill from global .agents/skills directory
---
Skill body.
`
    const agentsGlobalSkillsDir = join(TEMP_HOME, ".agents", "skills")
    const skillDir = join(agentsGlobalSkillsDir, "agent-global-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), skillContent)

    mock.module("os", () => ({
      homedir: () => TEMP_HOME,
      tmpdir,
    }))

    //#when
    const { discoverGlobalAgentsSkills } = await import("./loader")
    const skills = await discoverGlobalAgentsSkills()
    const skill = skills.find(s => s.name === "agent-global-skill")

    //#then
    expect(skill).toBeDefined()
    expect(skill?.scope).toBe("user")
    expect(skill?.definition.description).toContain("A skill from global .agents/skills directory")
  })
})
