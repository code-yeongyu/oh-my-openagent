import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"

import {
  formatSkillNameFrontmatterRepairReport,
  repairMissingSkillNameFrontmatter,
  repairSkillNameFrontmatterContent,
  setSkillFrontmatterField,
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

// Regression guard for the 2026-09-04 skill-body wipe: an ad-hoc description
// rewrite used /^(---\n[\s\S]*?)(\ndescription:)([^\n]*(?:\n\s+[^\n]*)*)([\s\S]*?\n---)/
// and rebuilt the file as m1+m2+new+m4. Group 4 ran to the CLOSING delimiter, so
// every byte after the frontmatter was discarded: 38 SKILL.md files under
// ~/.agents/skills were left frontmatter-only, and 47 symlinks propagated the
// damage into their оpenclaw originals. Any frontmatter write MUST leave the
// body byte-identical, which is what these cases pin.
describe("setSkillFrontmatterField", () => {
  function bodyOf(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
    return match ? content.slice(match[0].length) : content
  }

  test("#given a skill with a body #when the description is rewritten #then the body bytes are identical", () => {
    // given
    const body = "# Commit\n\nStep one.\n\n## Rules\n\n- never force push\n"
    const content = `---\nname: commit\ndescription: "old"\n---\n${body}`

    // when
    const result = setSkillFrontmatterField(content, "description", "new routing line")

    // then
    expect(result.changed).toBe(true)
    expect(bodyOf(result.content)).toBe(body)
    expect(result.content).toContain('description: "new routing line"')
    expect(result.content).not.toContain('description: "old"')
  })

  test("#given a body containing a --- horizontal rule #when rewritten #then nothing after the frontmatter is lost", () => {
    // given — the exact shape that made the original regex destructive
    const body = "# Skill\n\nIntro.\n\n---\n\n## Section\n\nTail line.\n"
    const content = `---\nname: x\ndescription: old\n---\n${body}`

    // when
    const result = setSkillFrontmatterField(content, "description", "replacement")

    // then
    expect(bodyOf(result.content)).toBe(body)
    expect(result.content.endsWith("Tail line.\n")).toBe(true)
  })

  test("#given a multi-line folded description #when rewritten #then continuation lines are replaced and the body survives", () => {
    // given
    const body = "Body stays.\n"
    const content = `---\nname: x\ndescription: first line\n  continued line\n  another\nlicense: MIT\n---\n${body}`

    // when
    const result = setSkillFrontmatterField(content, "description", "single line now")

    // then
    expect(bodyOf(result.content)).toBe(body)
    expect(result.content).toContain("license: MIT")
    expect(result.content).not.toContain("continued line")
  })

  test("#given CRLF frontmatter #when rewritten #then the body keeps its bytes and CRLF endings", () => {
    // given
    const body = "line one\r\nline two\r\n"
    const content = `---\r\nname: x\r\ndescription: old\r\n---\r\n${body}`

    // when
    const result = setSkillFrontmatterField(content, "description", "new")

    // then
    expect(result.changed).toBe(true)
    expect(bodyOf(result.content)).toBe(body)
    expect(result.content).toContain("---\r\nname: x\r\ndescription: new\r\n---\r\n")
  })

  test("#given no frontmatter #when rewritten #then the content is refused untouched", () => {
    // given
    const content = "# Just a document\n\nNo frontmatter here.\n"

    // when
    const result = setSkillFrontmatterField(content, "description", "x")

    // then
    expect(result.changed).toBe(false)
    expect(result.content).toBe(content)
    expect(result.reason).toBe("missing YAML frontmatter")
  })

  test("#given the same value already quoted #when rewritten #then it reports no change", () => {
    // given
    const content = '---\nname: x\ndescription: "same"\n---\nBody\n'

    // when
    const result = setSkillFrontmatterField(content, "description", "same")

    // then
    expect(result.changed).toBe(false)
    expect(result.content).toBe(content)
  })

  test("#given a missing field #when set #then it is appended to the frontmatter and the body survives", () => {
    // given
    const body = "# Doc\n\nText.\n"
    const content = `---\nname: x\n---\n${body}`

    // when
    const result = setSkillFrontmatterField(content, "description", "added line")

    // then
    expect(result.changed).toBe(true)
    expect(result.content).toBe(`---\nname: x\ndescription: "added line"\n---\n${body}`)
  })

  test("#given the exact regex that caused the 2026-09-04 wipe #when compared #then the helper keeps what it destroyed", () => {
    // given — verbatim from the incident record; group 4 runs to the closing ---
    const destructive = /^(---\n[\s\S]*?)(\ndescription:)([^\n]*(?:\n\s+[^\n]*)*)([\s\S]*?\n---)/
    const body = "# Skill\n\nBody that must survive.\n"
    const content = `---\nname: x\ndescription: old\n---\n${body}`

    // when
    const match = content.match(destructive)
    const wiped = match ? `${match[1]}${match[2]} new${match[4]}` : content
    const repaired = setSkillFrontmatterField(content, "description", "new")

    // then
    expect(bodyOf(wiped)).toBe("")
    expect(bodyOf(repaired.content)).toBe(body)
  })
})
