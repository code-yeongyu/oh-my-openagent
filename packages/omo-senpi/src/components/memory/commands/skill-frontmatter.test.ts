import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"

import {
  formatSkillNameFrontmatterRepairReport,
  repairMissingSkillNameFrontmatter,
  repairSkillNameFrontmatterContent,
} from "./skill-frontmatter"

const tempDirs: string[] = []

async function tempRoot(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "skill-frontmatter-")))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("repairSkillNameFrontmatterContent", () => {
  test("#given frontmatter without a name key #when repaired #then the directory name is inserted first", () => {
    // given
    const content = "---\ndescription: Commit helper\n---\nBody\n"

    // when
    const result = repairSkillNameFrontmatterContent(content, "commit")

    // then
    expect(result.changed).toBe(true)
    expect(result.content).toBe("---\nname: commit\ndescription: Commit helper\n---\nBody\n")
  })

  test("#given an existing non-empty name #when repaired #then the content is untouched", () => {
    // given
    const content = "---\nname: commit\ndescription: Commit helper\n---\n"

    // when
    const result = repairSkillNameFrontmatterContent(content, "other")

    // then
    expect(result.changed).toBe(false)
    expect(result.content).toBe(content)
  })

  test("#given an empty name value #when repaired #then the line is replaced in place", () => {
    // given
    const content = "---\ndescription: x\nname:   \n---\n"

    // when
    const result = repairSkillNameFrontmatterContent(content, "commit")

    // then
    expect(result.changed).toBe(true)
    expect(result.content).toBe("---\ndescription: x\nname: commit\n---\n")
  })

  test("#given no frontmatter at all #when repaired #then the file is skipped with a reason", () => {
    // given / when
    const result = repairSkillNameFrontmatterContent("# just markdown\n", "commit")

    // then
    expect(result.changed).toBe(false)
    expect(result.reason).toBe("missing YAML frontmatter")
  })

  test("#given a name needing quoting #when repaired #then the scalar is quoted", () => {
    // given
    const content = "---\ndescription: x\n---\n"

    // when
    const result = repairSkillNameFrontmatterContent(content, "my skill")

    // then
    expect(result.content).toContain('name: "my skill"')
  })
})

describe("repairMissingSkillNameFrontmatter", () => {
  test("#given no skills directory #when repaired #then nothing is scanned", async () => {
    // given
    const dir = await tempRoot()

    // when
    const result = await repairMissingSkillNameFrontmatter(dir)

    // then
    expect(result.scanned).toBe(0)
    expect(result.repaired).toEqual([])
    expect(result.skipped).toEqual([])
  })

  test("#given skill files in nested directories #when repaired #then only name-less files change", async () => {
    // given
    const dir = await tempRoot()
    await mkdir(join(dir, "skills", "commit"), { recursive: true })
    await writeFile(join(dir, "skills", "commit", "SKILL.md"), "---\ndescription: x\n---\n")
    await mkdir(join(dir, "skills", "nested", "review"), { recursive: true })
    await writeFile(join(dir, "skills", "nested", "review", "SKILL.md"), "---\nname: review\ndescription: y\n---\n")
    await mkdir(join(dir, "skills", "flat"), { recursive: true })
    await writeFile(join(dir, "skills", "flat", "notes.md"), "---\ndescription: not a skill\n---\n")

    // when
    const result = await repairMissingSkillNameFrontmatter(dir)

    // then
    expect(result.scanned).toBe(2)
    expect(result.repaired).toEqual(["skills/commit/SKILL.md"])
    expect(result.skipped).toEqual([])
    const repaired = await readFile(join(dir, "skills", "commit", "SKILL.md"), "utf8")
    expect(repaired).toContain("name: commit")
  })

  test("#given a repaired file and a skipped file #when the report is formatted #then both sections render", async () => {
    // given
    const dir = await tempRoot()
    await mkdir(join(dir, "skills", "commit"), { recursive: true })
    await writeFile(join(dir, "skills", "commit", "SKILL.md"), "---\ndescription: x\n---\n")
    await mkdir(join(dir, "skills", "broken"), { recursive: true })
    await writeFile(join(dir, "skills", "broken", "SKILL.md"), "no frontmatter\n")
    const result = await repairMissingSkillNameFrontmatter(dir)

    // when
    const report = formatSkillNameFrontmatterRepairReport(result)

    // then
    expect(report).toContain("skills/commit/SKILL.md")
    expect(report).toContain("skills/broken/SKILL.md")
    expect(report).toContain("missing YAML frontmatter")
  })
})
