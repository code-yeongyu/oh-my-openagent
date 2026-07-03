import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const skillsRoot = join(repoRoot, "packages", "omo-senpi", "plugin", "skills")
const expectedSkillNames = ["ultrawork", "ulw-loop"] as const
const forbiddenTokenPattern = /\b(?:codex|multi_agent|spawn_agent)\b/i

function listDirectoryNames(path: string): string[] {
  if (!existsSync(path)) {
    throw new Error(`${relative(repoRoot, path)} does not exist; run packages/omo-senpi/plugin/scripts/sync-skills.mjs`)
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function listFiles(path: string): string[] {
  const entries = readdirSync(path, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function readFrontmatter(content: string, path: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (match === null) {
    throw new Error(`${relative(repoRoot, path)} is missing YAML frontmatter`)
  }
  return match[1]
}

function expectFrontmatterField(frontmatter: string, field: string, path: string): void {
  const pattern = new RegExp(`^${field}:\\s*\\S`, "m")
  expect(pattern.test(frontmatter), `${relative(repoRoot, path)} frontmatter must include ${field}`).toBe(true)
}

describe("OMO Senpi scoped skill sync", () => {
  test("#given synced skill output #when inspected #then only ultrawork and ulw-loop roots exist", () => {
    expect(listDirectoryNames(skillsRoot)).toEqual([...expectedSkillNames].sort())

    for (const skillName of expectedSkillNames) {
      const skillFile = join(skillsRoot, skillName, "SKILL.md")
      expect(existsSync(skillFile), `${relative(repoRoot, skillFile)} must exist`).toBe(true)
      expect(statSync(skillFile).isFile(), `${relative(repoRoot, skillFile)} must be a file`).toBe(true)
    }

    expect(existsSync(join(skillsRoot, "ulw-plan"))).toBe(false)
  })

  test("#given synced skill roots #when frontmatter is parsed #then every root skill has name and description", () => {
    for (const skillName of expectedSkillNames) {
      const skillFile = join(skillsRoot, skillName, "SKILL.md")
      const frontmatter = readFrontmatter(readFileSync(skillFile, "utf8"), skillFile)

      expectFrontmatterField(frontmatter, "name", skillFile)
      expectFrontmatterField(frontmatter, "description", skillFile)
    }
  })

  test("#given synced skill files #when scanned #then no Codex or multi-agent harness guidance survives", () => {
    const files = listFiles(skillsRoot)
    expect(files.map((file) => relative(skillsRoot, file)).sort()).toContain("ulw-loop/references/full-workflow.md")

    const leaks = files.flatMap((file) => {
      const content = readFileSync(file, "utf8")
      return forbiddenTokenPattern.test(content) ? [relative(repoRoot, file)] : []
    })

    expect(leaks).toEqual([])
  })
})
