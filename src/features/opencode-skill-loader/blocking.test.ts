import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { discoverAllSkillsBlocking } from "./blocking"
import type { SkillScope } from "./types"

const TEST_DIR = join(tmpdir(), `blocking-test-${Date.now()}`)

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe("discoverAllSkillsBlocking", () => {
  it("returns skills synchronously from valid directories", () => {
    // #given valid skill directory
    const skillDir = join(TEST_DIR, "skills")
    mkdirSync(skillDir, { recursive: true })

    const skillMdPath = join(skillDir, "test-skill.md")
    writeFileSync(
      skillMdPath,
      `---
name: test-skill
description: A test skill
---
This is test skill content.`
    )

    const dirs = [skillDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then returns skills synchronously
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("test-skill")
    expect(skills[0].definition.description).toContain("test skill")
  })

  it("returns empty array for empty directories", () => {
    // #given empty directory
    const emptyDir = join(TEST_DIR, "empty")
    mkdirSync(emptyDir, { recursive: true })

    const dirs = [emptyDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then returns empty array
    expect(skills).toBeArray()
    expect(skills.length).toBe(0)
  })

  it("returns empty array for non-existent directories", () => {
    // #given non-existent directory
    const nonExistentDir = join(TEST_DIR, "does-not-exist")

    const dirs = [nonExistentDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then returns empty array (no throw)
    expect(skills).toBeArray()
    expect(skills.length).toBe(0)
  })

  it("handles multiple directories with mixed content", () => {
    // #given multiple directories with valid and invalid skills
    const dir1 = join(TEST_DIR, "dir1")
    const dir2 = join(TEST_DIR, "dir2")
    mkdirSync(dir1, { recursive: true })
    mkdirSync(dir2, { recursive: true })

    writeFileSync(
      join(dir1, "skill1.md"),
      `---
name: skill1
description: First skill
---
Skill 1 content.`
    )

    writeFileSync(
      join(dir2, "skill2.md"),
      `---
name: skill2
description: Second skill
---
Skill 2 content.`
    )

    const dirs = [dir1, dir2]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then returns all valid skills
    expect(skills).toBeArray()
    expect(skills.length).toBe(2)
    
    const skillNames = skills.map(s => s.name).sort()
    expect(skillNames).toEqual(["skill1", "skill2"])
  })

  it("skips invalid YAML files", () => {
    // #given directory with invalid YAML
    const skillDir = join(TEST_DIR, "skills")
    mkdirSync(skillDir, { recursive: true })

    const validSkillPath = join(skillDir, "valid.md")
    writeFileSync(
      validSkillPath,
      `---
name: valid-skill
description: Valid skill
---
Valid skill content.`
    )

    const invalidSkillPath = join(skillDir, "invalid.md")
    writeFileSync(
      invalidSkillPath,
      `---
name: invalid skill
description: [ invalid yaml
---
Invalid content.`
    )

    const dirs = [skillDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then skips invalid, returns valid
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("valid-skill")
  })

  it("handles directory-based skills with SKILL.md", () => {
    // #given directory-based skill structure
    const skillsDir = join(TEST_DIR, "skills")
    const mySkillDir = join(skillsDir, "my-skill")
    mkdirSync(mySkillDir, { recursive: true })

    const skillMdPath = join(mySkillDir, "SKILL.md")
    writeFileSync(
      skillMdPath,
      `---
name: my-skill
description: Directory-based skill
---
This is a directory-based skill.`
    )

    const dirs = [skillsDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then returns skill from SKILL.md
    expect(skills).toBeArray()
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("my-skill")
  })

  it("processes large skill sets without timeout", () => {
    // #given directory with many skills (20+)
    const skillDir = join(TEST_DIR, "many-skills")
    mkdirSync(skillDir, { recursive: true })

    const skillCount = 25
    for (let i = 0; i < skillCount; i++) {
      const skillPath = join(skillDir, `skill-${i}.md`)
      writeFileSync(
        skillPath,
        `---
name: skill-${i}
description: Skill number ${i}
---
Content for skill ${i}.`
      )
    }

    const dirs = [skillDir]
    const scopes: SkillScope[] = ["opencode-project"]

    // #when discoverAllSkillsBlocking called
    const skills = discoverAllSkillsBlocking(dirs, scopes)

    // #then completes without timeout
    expect(skills).toBeArray()
    expect(skills.length).toBe(skillCount)
  })
})
