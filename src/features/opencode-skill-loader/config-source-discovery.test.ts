import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { SkillsConfigSchema } from "../../config/schema/skills"
import { discoverConfigSourceSkills, normalizePathForGlob } from "./config-source-discovery"

const TEST_DIR = join(tmpdir(), `config-source-discovery-test-${Date.now()}`)

function writeSkill(path: string, name: string, description: string): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`,
  )
}

describe("config source discovery", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("loads skills from local sources path", async () => {
    // given
    const configDir = join(TEST_DIR, "config")
    const sourceDir = join(configDir, "custom-skills")
    writeSkill(join(sourceDir, "local-skill"), "local-skill", "Loaded from local source")
    const config = SkillsConfigSchema.parse({
      sources: [{ path: "./custom-skills", recursive: true }],
    })

    // when
    const skills = await discoverConfigSourceSkills({
      config,
      configDir,
    })

    // then
    const localSkill = skills.find((skill) => skill.name === "local-skill")
    expect(localSkill).toBeDefined()
    expect(localSkill?.scope).toBe("config")
    expect(localSkill?.definition.description).toContain("Loaded from local source")
  })

  it("filters discovered skills using source glob", async () => {
    // given
    const configDir = join(TEST_DIR, "config")
    const sourceDir = join(configDir, "custom-skills")

    writeSkill(join(sourceDir, "keep", "kept"), "kept-skill", "Should be kept")
    writeSkill(join(sourceDir, "skip", "skipped"), "skipped-skill", "Should be skipped")
    const config = SkillsConfigSchema.parse({
      sources: [{ path: "./custom-skills", recursive: true, glob: "keep/**" }],
    })

    // when
    const skills = await discoverConfigSourceSkills({
      config,
      configDir,
    })

    // then
    const names = skills.map((skill) => skill.name)
    expect(names).toContain("keep/kept-skill")
    expect(names).not.toContain("skip/skipped-skill")
  })

  it("normalizes windows separators before glob matching", () => {
    // given
    const windowsPath = "keep\\nested\\SKILL.md"

    // when
    const normalized = normalizePathForGlob(windowsPath)

    // then
    expect(normalized).toBe("keep/nested/SKILL.md")
  })
})
