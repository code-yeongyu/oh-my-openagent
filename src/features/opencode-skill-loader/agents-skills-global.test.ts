import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "path"
import { tmpdir } from "os"

describe("discoverGlobalAgentsSkills", () => {
  let testDir: string
  let tempHome: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "agents-global-skills-test-"))
    tempHome = join(testDir, "home")
    mkdirSync(tempHome, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("#given a skill in ~/.agents/skills/ #when discoverGlobalAgentsSkills is called #then it discovers the skill", async () => {
    //#given
    const skillContent = `---
name: agent-global-skill
description: A skill from global .agents/skills directory
---
Skill body.
`
    const agentsGlobalSkillsDir = join(tempHome, ".agents", "skills")
    const skillDir = join(agentsGlobalSkillsDir, "agent-global-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), skillContent)

    //#when
    const { discoverGlobalAgentsSkills } = await import(`./loader?test=${crypto.randomUUID()}`)
    const skills = await discoverGlobalAgentsSkills(tempHome)
    const skill = skills.find(s => s.name === "agent-global-skill")

    //#then
    expect(skill).toBeDefined()
    expect(skill?.scope).toBe("user")
    expect(skill?.definition.description).toContain("A skill from global .agents/skills directory")
  })
})
