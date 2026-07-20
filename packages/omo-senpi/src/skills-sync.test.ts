import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const skillsRoot = join(repoRoot, "packages", "omo-senpi", "plugin", "skills")

const expectedSkillNames = [
  "ast-grep",
  "coding-agent-sessions",
  "debugging",
  "frontend",
  "git-master",
  "hyperplan",
  "init-deep",
  "lsp-setup",
  "programming",
  "refactor",
  "remove-ai-slops",
  "review-work",
  "start-work",
  "ultimate-browsing",
  "ultrawork",
  "ulw-loop",
  "ulw-plan",
  "ulw-research",
  "visual-qa",
] as const

const CODEX_DERIVED_SKILL_NAMES: Record<string, true> = {
  ultrawork: true,
  "ulw-loop": true,
}
// Skills authored directly against the omo-senpi tool surface. They already speak native Senpi tools,
// so they carry no OpenCode examples and need no "Senpi Harness Tool Compatibility" translation banner.
const NATIVE_SENPI_SKILL_NAMES: Record<string, true> = {
  hyperplan: true,
}
const sharedSkillNames = expectedSkillNames.filter(
  (name) => !(name in CODEX_DERIVED_SKILL_NAMES) && !(name in NATIVE_SENPI_SKILL_NAMES),
)
const namePattern = /^[a-z0-9-]{1,64}$/
const forbiddenTokenPattern = /\b(?:codex|multi_agent|spawn_agent)\b/i
const opencodeOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/
const compatibilitySectionHeading = "## Senpi Harness Tool Compatibility"

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

function extractFrontmatterField(frontmatter: string, field: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.*?)$`, "m"))
  return match?.[1]?.trim()
}

describe("OMO Senpi scoped skill sync", () => {
  test("#given synced skill output #when inspected #then exactly 19 roots exist with valid names", () => {
    const actualNames = listDirectoryNames(skillsRoot)
    expect(actualNames).toEqual([...expectedSkillNames].sort())

    for (const skillName of expectedSkillNames) {
      const skillFile = join(skillsRoot, skillName, "SKILL.md")
      expect(existsSync(skillFile), `${relative(repoRoot, skillFile)} must exist`).toBe(true)
      expect(statSync(skillFile).isFile(), `${relative(repoRoot, skillFile)} must be a file`).toBe(true)
      expect(namePattern.test(skillName), `${skillName} must match ${namePattern.source}`).toBe(true)
    }
  })

  test("#given synced skill roots #when frontmatter is parsed #then every root skill has name, description, and valid values", () => {
    for (const skillName of expectedSkillNames) {
      const skillFile = join(skillsRoot, skillName, "SKILL.md")
      const content = readFileSync(skillFile, "utf8")
      const frontmatter = readFrontmatter(content, skillFile)

      expectFrontmatterField(frontmatter, "name", skillFile)
      expectFrontmatterField(frontmatter, "description", skillFile)

      const name = extractFrontmatterField(frontmatter, "name")
      expect(name, `${relative(repoRoot, skillFile)} frontmatter name must equal ${skillName}`).toBe(skillName)

      const descriptionLine = frontmatter.match(/^description:\\s*(.*)$/m)?.[0] ?? ""
      expect(
        descriptionLine.length,
        `${relative(repoRoot, skillFile)} description line must be <= 1024 chars`,
      ).toBeLessThanOrEqual(1024)
    }
  })

  test("#given codex-derived skill roots #when scanned #then no Codex or multi-agent harness guidance survives", () => {
    const leaks: string[] = []

    for (const skillName of Object.keys(CODEX_DERIVED_SKILL_NAMES)) {
      const skillRoot = join(skillsRoot, skillName)
      if (!existsSync(skillRoot)) continue

      for (const file of listFiles(skillRoot)) {
        const content = readFileSync(file, "utf8")
        if (forbiddenTokenPattern.test(content)) {
          leaks.push(relative(repoRoot, file))
        }
      }
    }

    expect(leaks).toEqual([])
  })

  test("#given shared skill roots with opencode orchestration #when inspected #then a Senpi compatibility section precedes the first example", () => {
    const missing: string[] = []

    for (const skillName of sharedSkillNames) {
      const skillFile = join(skillsRoot, skillName, "SKILL.md")
      if (!existsSync(skillFile)) continue

      const content = readFileSync(skillFile, "utf8")
      const firstExampleMatch = opencodeOrchestrationPattern.exec(content)
      if (firstExampleMatch === null) continue

      const sectionIndex = content.indexOf(compatibilitySectionHeading)
      if (sectionIndex === -1 || sectionIndex > firstExampleMatch.index) {
        missing.push(relative(repoRoot, skillFile))
      }
    }

    expect(missing).toEqual([])
  })

  test("#given start-work skill #when inspected #then session ids reference senpi, not codex", () => {
    const skillFile = join(skillsRoot, "start-work", "SKILL.md")
    const content = readFileSync(skillFile, "utf8")

    expect(content.includes("senpi:<session_id>"), "start-work must reference senpi:<session_id>").toBe(true)
    expect(content.includes("codex:<session_id>"), "start-work must not reference codex:<session_id>").toBe(false)
  })

  test("#given synced skill tree #when inspected #then no codex-only display metadata is packaged", () => {
    const openaiFiles = listFiles(skillsRoot).filter((file) => file.endsWith("agents/openai.yaml"))
    expect(openaiFiles.map((file) => relative(repoRoot, file))).toEqual([])
  })

  test("#given frontend skill #when inspected #then materialized design references exist", () => {
    const refsDir = join(skillsRoot, "frontend", "references", "design")
    expect(existsSync(refsDir), "frontend/references/design must exist after materialization").toBe(true)
  })
})
