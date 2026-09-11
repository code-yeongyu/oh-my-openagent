import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { BUILTIN_AGENTS, DEFAULT_CATEGORIES } from "@oh-my-opencode/senpi-task"
import { BUILTIN_SKILL_NAMES } from "./components/telemetry/product-identity"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const skillsRoot = join(repoRoot, "packages", "omo-senpi", "plugin", "skills")

const expectedSkillNames = [
  "ast-grep",
  "coding-agent-sessions",
  "dag-library",
  "data-scientist",
  "debugging",
  "frontend",
  "git-master",
  "give-me-tips",
  "hyperplan",
  "init-deep",
  "lsp-setup",
  "mass-ulw",
  "onboarding",
  "programming",
  "refactor",
  "remove-ai-slops",
  "review-work",
  "ultimate-browsing",
  "ultrawork",
  "ulw-execute",
  "ulw-loop",
  "ulw-plan",
  "ulw-research",
  "visual-qa",
] as const

const CODEX_DERIVED_SKILL_NAMES: Record<string, true> = {}
// Skills authored directly against the omo-senpi tool surface. They already speak native Senpi tools,
// so they carry no OpenCode examples and need no "Senpi Harness Tool Compatibility" translation banner.
const NATIVE_SENPI_SKILL_NAMES: Record<string, true> = {
  "dag-library": true,
  "give-me-tips": true,
  hyperplan: true,
  "init-deep": true,
  "mass-ulw": true,
  onboarding: true,
  ultrawork: true,
  "ulw-loop": true,
  "ulw-research": true,
}
const namePattern = /^[a-z0-9-]{1,64}$/
const forbiddenTokenPattern = /\b(?:codex|multi_agent|spawn_agent|update_plan)\b/i
// The ulw-loop CLI literally accepts `--codex-goal-json`; that interface name is not Codex
// guidance, so mask it before scanning for leaked harness tokens.
const cliInterfaceFlagPattern = /--codex-goal-json/g
const taskTargetPattern = /\b(subagent_type|category)["']?\s*[=:]\s*["']([a-z0-9-]+)["']/g
// Retired persona names (plan: omo-senpi-role-names) must not ship to Senpi users through the
// synced output. plugin/skills/ is gitignored, so this file is the ONLY gate for it: the root
// retired-name gate and the repo-wide CI scans cannot see generated skill bundles.
const retiredPersonaNamePattern = /\b(?:sisyphus-junior|hephaestus|prometheus|atlas|metis|momus)\b/i
const retiredSubagentTypePattern = /subagent_type=["']?(?:oracle|sisyphus)/
// `github.com/prometheus/client_golang` is the third-party Go metrics module, not the planner
// persona — the same carve-out class as keeping the generic lowercase "oracle" noun legal in
// debugging/visual-qa methodology prose.
const thirdPartyModulePathPattern = /github\.com\/prometheus\/client_golang/
// A line ending in the plan-wide marker is a sanctioned legacy mention (e.g. the ulw-plan
// review.momus reading rule); todo 23's root gate asserts these markers stay scarce repo-wide.
const retiredNameAllowedMarker = /<!-- retired-name-allowed -->\s*$/
// PENDING RETIREMENT — reported to the plan lead for a follow-up todo: persona names that still
// live in shared-skill files outside this gate's owning change (todo 11 edits only
// ulw-execute/SKILL.md and three refactor/SKILL.md lines; the files below belong to no todo in
// the plan). Each entry exempts ONLY lines matching the pattern in that exact file; any other
// occurrence anywhere still fails. Shrink this list to zero as the follow-up lands.
const pendingPersonaNameRetirements: readonly {
  readonly pathSuffix: string
  readonly linePattern: RegExp
}[] = [
  { pathSuffix: "coding-agent-sessions/references/opencode.md", linePattern: /`Sisyphus-Junior`/ },
  { pathSuffix: "frontend/references/designpowers/lane-a-direction.md", linePattern: /\bPrometheus\b/ },
  { pathSuffix: "frontend/references/designpowers/routing.md", linePattern: /\bPrometheus\b/ },
]

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
  test("#given the telemetry builtin skill allowlist #when compared with packaged skills #then it stays exact and frozen", () => {
    const telemetrySkillNames: readonly string[] = BUILTIN_SKILL_NAMES
    expect(Object.isFrozen(BUILTIN_SKILL_NAMES)).toBe(true)
    expect(BUILTIN_SKILL_NAMES.length).toBeGreaterThan(0)
    expect([...telemetrySkillNames].sort()).toEqual(listDirectoryNames(skillsRoot))
  })

  test("#given synced skill output #when inspected #then exactly 24 roots exist with valid names", () => {
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

      const descriptionLine = frontmatter.match(/^description:\s*(.*)$/m)?.[0] ?? ""
      expect(
        descriptionLine.length,
        `${relative(repoRoot, skillFile)} description line must be <= 1024 chars`,
      ).toBeLessThanOrEqual(1024)
    }
  })

  test("#given codex-derived and native skill roots #when scanned #then no Codex or multi-agent harness guidance survives", () => {
    const leaks: string[] = []

    for (const skillName of [...Object.keys(CODEX_DERIVED_SKILL_NAMES), ...Object.keys(NATIVE_SENPI_SKILL_NAMES)]) {
      const skillRoot = join(skillsRoot, skillName)
      if (!existsSync(skillRoot)) continue

      for (const file of listFiles(skillRoot)) {
        const content = readFileSync(file, "utf8").replace(cliInterfaceFlagPattern, "")
        if (forbiddenTokenPattern.test(content)) {
          leaks.push(relative(repoRoot, file))
        }
      }
    }

    expect(leaks).toEqual([])
  })

  test("#given native senpi skills #when synced output is compared #then they ship verbatim modulo blank-line normalization", () => {
    for (const skillName of Object.keys(NATIVE_SENPI_SKILL_NAMES)) {
      const sourceFile = join(repoRoot, "packages", "omo-senpi", "skills", skillName, "SKILL.md")
      expect(existsSync(sourceFile), `${relative(repoRoot, sourceFile)} must exist`).toBe(true)

      const source = readFileSync(sourceFile, "utf8").replace(/\n{3,}/g, "\n\n")
      const shippedPath = join(skillsRoot, skillName, "SKILL.md")
      const shipped = readFileSync(shippedPath, "utf8")
      expect(shipped, `${relative(repoRoot, shippedPath)} must ship the native source verbatim`).toBe(source)
    }
  })

  test("#given ulw-research skill #when synced #then the X / social lane bullet is shipped", () => {
    const skillFile = join(skillsRoot, "ulw-research", "SKILL.md")
    const content = readFileSync(skillFile, "utf8")

    expect(content.includes("X / social (`x_search`"), "ulw-research must ship the X / social lane role protocol").toBe(true)
  })

  test("#given ulw-execute skill #when inspected #then session ids reference senpi, not codex", () => {
    const skillFile = join(skillsRoot, "ulw-execute", "SKILL.md")
    const content = readFileSync(skillFile, "utf8")

    expect(content.includes("senpi:<session_id>"), "ulw-execute must reference senpi:<session_id>").toBe(true)
    expect(content.includes("codex:<session_id>"), "ulw-execute must not reference codex:<session_id>").toBe(false)
  })

  test("#given ulw-execute skill #when inspected #then the senpi banner advertises senpi watcher tools, not a codex wait idiom", () => {
    const skillFile = join(skillsRoot, "ulw-execute", "SKILL.md")
    const content = readFileSync(skillFile, "utf8")

    expect(/\bmonitor\b/.test(content), "ulw-execute must name the senpi tool that arms a lane watcher").toBe(true)
    expect(/\bkill_bash\b/.test(content), "ulw-execute must name the senpi tool that tears a watcher down").toBe(true)
    expect(/\bwait_agent\b/.test(content), "ulw-execute must not carry the codex wait_agent polling idiom").toBe(false)
  })

  test("#given synced skill tree #when inspected #then no codex-only display metadata is packaged", () => {
    const openaiFiles = listFiles(skillsRoot).filter((file) => file.endsWith("agents/openai.yaml"))
    expect(openaiFiles.map((file) => relative(repoRoot, file))).toEqual([])
  })

  test("#given ported orchestration skills #when scanned #then no foreign-harness delegation guidance survives", () => {
    const portedOrchestrationSkillNames = ["ulw-execute", "ulw-plan"] as const
    const foreignDelegationPattern = /\b(?:multi_agent|spawn_agent|lazycodex)\b/i
    const leaks: string[] = []

    for (const skillName of portedOrchestrationSkillNames) {
      const skillRoot = join(skillsRoot, skillName)
      if (!existsSync(skillRoot)) continue

      for (const file of listFiles(skillRoot)) {
        const content = readFileSync(file, "utf8")
        if (foreignDelegationPattern.test(content)) {
          leaks.push(`${relative(repoRoot, file)}: foreign delegation tool guidance`)
        }
        if (skillName === "ulw-plan" && /\boracle\b/i.test(content)) {
          leaks.push(`${relative(repoRoot, file)}: oracle reviewer does not exist in omo-senpi`)
        }
      }
    }

    expect(leaks).toEqual([])
  })

  test("#given the synced review-work skill #when its body task targets are scanned #then it dispatches exactly one gate reviewer", () => {
    const content = readFileSync(join(skillsRoot, "review-work", "SKILL.md"), "utf8")
    // Skip the frontmatter and the Senpi compatibility banner: only the skill body dispatches reviewers.
    const body = content.slice(content.indexOf("\n# "))
    const targets = [...body.matchAll(taskTargetPattern)].map(([, kind, name]) => `${kind}=${name}`)

    expect(targets).toEqual(["subagent_type=omo-senpi-gate-reviewer"])
  })

  test("#given shipped task examples #when targets are scanned #then every agent and category exists in Senpi", () => {
    const allowedTargets = {
      subagent_type: new Set(Object.keys(BUILTIN_AGENTS)),
      category: new Set(Object.keys(DEFAULT_CATEGORIES)),
    }
    const invalidTargets: string[] = []

    for (const file of listFiles(skillsRoot).filter((path) => path.endsWith(".md"))) {
      const content = readFileSync(file, "utf8")
      for (const match of content.matchAll(taskTargetPattern)) {
        const kind = match[1] as keyof typeof allowedTargets
        const target = match[2]
        if (target !== undefined && !allowedTargets[kind].has(target)) {
          invalidTargets.push(`${relative(repoRoot, file)}: ${kind}=${target}`)
        }
      }
    }

    expect(invalidTargets).toEqual([])
  })

  test("#given the synced skill output #when scanned #then no retired persona name or OpenCode-only agent id ships", () => {
    const leaks: string[] = []

    for (const file of listFiles(skillsRoot)) {
      // `relative` yields `\`-separated paths on Windows; the exemption suffixes are written with
      // `/`, so compare on a normalized form or the exemptions silently stop matching there.
      const relativePath = relative(repoRoot, file).replaceAll("\\", "/")
      const lines = readFileSync(file, "utf8").split("\n")
      for (const [index, line] of lines.entries()) {
        if (retiredNameAllowedMarker.test(line)) continue
        if (thirdPartyModulePathPattern.test(line)) continue
        const pendingRetirement = pendingPersonaNameRetirements.some(
          ({ pathSuffix, linePattern }) => relativePath.endsWith(pathSuffix) && linePattern.test(line),
        )
        if (pendingRetirement) continue
        if (retiredPersonaNamePattern.test(line) || retiredSubagentTypePattern.test(line)) {
          leaks.push(`${relativePath}:${index + 1}: ${line.trim()}`)
        }
      }
    }

    expect(leaks).toEqual([])
  })

  test("#given frontend skill #when inspected #then materialized design references exist", () => {
    const refsDir = join(skillsRoot, "frontend", "references", "design")
    expect(existsSync(refsDir), "frontend/references/design must exist after materialization").toBe(true)
  })
})
