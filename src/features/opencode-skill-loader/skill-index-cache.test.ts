import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { skillIndexToLoadedSkills, type SkillIndexEntry } from "./skill-index-cache"

const TEST_DIR = join(tmpdir(), `skill-index-cache-test-${randomUUID()}`)

describe("skill-index-cache", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("converts cached index entries into LoadedSkill stubs with lazy body loading", async () => {
    // given
    const skillDir = join(TEST_DIR, "my-skill")
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, "SKILL.md")
    writeFileSync(
      skillPath,
      `---
description: My skill
---
Hello from SKILL.md
`,
    )

    const entries: SkillIndexEntry[] = [
      {
        name: "my-skill",
        scope: "opencode-project",
        description: "(opencode-project - Skill) My skill",
        path: skillPath,
        resolvedPath: skillDir,
      },
    ]

    // when
    const loaded = skillIndexToLoadedSkills(entries)

    // then
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.definition.template).toBe("")
    expect(loaded[0]?.lazyContent).toBeDefined()

    const template = await loaded[0]!.lazyContent!.load()
    expect(template).toContain("<skill-instruction>")
    expect(template).toContain("Hello from SKILL.md")
    expect(template).toContain(`Base directory for this skill: ${skillDir}/`)
  })
})

