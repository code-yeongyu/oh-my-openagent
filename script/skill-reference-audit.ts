import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

import { BUILTIN_AGENT_NAMES } from "../packages/senpi-task/src/agents/builtin/names"
import { LEGACY_AGENT_NAME_ALIASES } from "../packages/senpi-task/src/agents/builtin/legacy-agent-names"
import { DEFAULT_CATEGORIES as SENPI_CATEGORIES } from "../packages/senpi-task/src/category/builtins"
import { LEGACY_CATEGORY_NAME_ALIASES } from "../packages/omo-config-core/src/schema/legacy-category-names"
import {
  BuiltinAgentNameSchema,
  BuiltinSkillNameSchema,
  OverridableAgentNameSchema,
} from "../packages/omo-opencode/src/config/schema/agent-names"
import { DEFAULT_CATEGORIES as OPENCODE_CATEGORIES } from "../packages/omo-opencode/src/tools/delegate-task/builtin-categories"
import { createNativeSkillSources } from "../packages/omo-senpi/plugin/scripts/native-skill-sources.mjs"
import {
  designpowersThirdPartyRelativePaths,
  frontendSkillRoot,
  keptDesignRelativePaths,
  thirdPartyRelativePaths,
} from "../packages/shared-skills/scripts/frontend-refs-manifest.mjs"

/**
 * Dangling-reference audit for shipped skills and prompts.
 *
 * Every skill name, skill-relative path, agent name and category name that a shipped SKILL.md or
 * prompt hands to a model must resolve to a real target in each edition that ships the file. A name
 * that resolves nowhere fails differently per edition (OpenCode refuses the whole `task` call with
 * "Skills not found", Senpi starts the child without the skill, a prose pointer loads nothing), so
 * the audit fails closed and suggests the nearest real name.
 *
 * An optional mention ("when the `x` skill is available", "if the session lists the `x` skill")
 * only needs `x` to exist in some edition; an unconditional one must exist in every edition that
 * ships the file.
 */

export type Edition = "senpi" | "opencode" | "codex" | "repo"
type ReferenceClass = "skill-name" | "skill-path" | "agent-name" | "category-name"

interface ReferenceFinding {
  readonly referenceClass: ReferenceClass
  readonly file: string
  readonly line: number
  readonly reference: string
  readonly missingIn: readonly Edition[]
  readonly suggestion: string | undefined
}

export interface ReferenceCatalog {
  readonly skills: Readonly<Record<Edition, ReadonlySet<string>>>
  readonly agents: Readonly<Record<Edition, ReadonlySet<string>>>
  readonly categories: Readonly<Record<Edition, ReadonlySet<string>>>
  readonly skillRoots: ReadonlyMap<string, readonly string[]>
}

export interface AuditedFile {
  readonly path: string
  readonly editions: readonly Edition[]
  readonly skillRoot: string | undefined
  readonly taskDialect: "opencode" | "senpi" | "codex"
}

/**
 * Codex's own bundled system skills (codex-rs/skills/src/assets/samples, openai/codex a3697361df).
 * Codex installs them in every session, so a Codex-edition skill may point at them.
 */
const CODEX_SYSTEM_SKILL_NAMES: readonly string[] = [
  "imagegen",
  "openai-docs",
  "review-agent",
  "skill-creator",
  "skill-installer",
]

const CODEX_BUILTIN_AGENT_TYPES: readonly string[] = ["default", "explorer", "worker"]

const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  "...",
  "a",
  "b",
  "example",
  "foo",
  "item-name",
  "my-skill",
  "name",
  "skill-1",
  "skill-2",
  "skill-name",
  "your-skill",
])

const SHIPPED_EDITIONS: readonly Edition[] = ["senpi", "opencode", "codex"]
const SKILL_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

function toPortable(path: string): string {
  return path.split(sep).join("/")
}

function listDirectories(path: string): string[] {
  if (!existsSync(path)) return []
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function listFilesRecursive(path: string): string[] {
  if (!existsSync(path)) return []
  const files: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      files.push(...listFilesRecursive(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function readSkillName(skillFile: string): string {
  const content = readFileSync(skillFile, "utf8").replace(/\r\n?/g, "\n")
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1]
  const name = frontmatter?.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1]?.trim()
  return name ?? basename(dirname(skillFile))
}

function skillRootsUnder(root: string): string[] {
  return listDirectories(root)
    .map((name) => join(root, name))
    .filter((skillRoot) => existsSync(join(skillRoot, "SKILL.md")))
}

function skillNamesUnder(root: string): string[] {
  return skillRootsUnder(root).map((skillRoot) => readSkillName(join(skillRoot, "SKILL.md")))
}

function codexComponentSkillRoots(repoRoot: string): string[] {
  const componentsRoot = join(repoRoot, "packages", "omo-codex", "plugin", "components")
  return listDirectories(componentsRoot).flatMap((component) =>
    skillRootsUnder(join(componentsRoot, component, "skills")),
  )
}

function codexAgentRoleNames(repoRoot: string): string[] {
  const componentsRoot = join(repoRoot, "packages", "omo-codex", "plugin", "components")
  return listDirectories(componentsRoot).flatMap((component) => {
    const agentsDir = join(componentsRoot, component, "agents")
    if (!existsSync(agentsDir)) return []
    return readdirSync(agentsDir)
      .filter((file) => file.endsWith(".toml"))
      .map(
        (file) =>
          readFileSync(join(agentsDir, file), "utf8").match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? basename(file, ".toml"),
      )
  })
}

/**
 * Skills the pinned Senpi engine contributes on its own: the codemode skill (`src/skill/<name>`) and
 * every builtin extension skill (`dist/core/extensions/builtin/<ext>/skill`). They are read from the
 * installed pin, so a skill renamed upstream fails this audit on the pin bump that ships the rename.
 */
function senpiEngineSkillRoots(repoRoot: string): string[] {
  const requireFromSenpiAdapter = createRequire(join(repoRoot, "packages", "omo-senpi", "package.json"))
  const senpiRoot = dirname(requireFromSenpiAdapter.resolve("@code-yeongyu/senpi/package.json"))
  const requireFromSenpi = createRequire(join(senpiRoot, "package.json"))
  const codemodeRoot = dirname(requireFromSenpi.resolve("@code-yeongyu/senpi-codemode/package.json"))
  const builtinRoot = join(senpiRoot, "dist", "core", "extensions", "builtin")
  const builtinSkillRoots = listDirectories(builtinRoot)
    .map((extension) => join(builtinRoot, extension, "skill"))
    .filter((skillRoot) => existsSync(join(skillRoot, "SKILL.md")))
  const codemodeSkillRoots = skillRootsUnder(join(codemodeRoot, "src", "skill"))
  if (codemodeSkillRoots.length === 0) {
    throw new Error(`no codemode skill found under ${codemodeRoot}/src/skill; the pinned senpi-codemode layout changed`)
  }
  return [...builtinSkillRoots, ...codemodeSkillRoots]
}

function union(...sets: ReadonlySet<string>[]): ReadonlySet<string> {
  return new Set(sets.flatMap((set) => [...set]))
}

function buildReferenceCatalog(repoRoot: string): ReferenceCatalog {
  const packagesRoot = join(repoRoot, "packages")
  const sharedRoots = skillRootsUnder(join(packagesRoot, "shared-skills", "skills"))
  const nativeSources = createNativeSkillSources(packagesRoot).sources
  const xSearchRoot = join(packagesRoot, "omo-senpi", "src", "components", "x-search", "skill")
  const loaderBuiltinRoots = skillRootsUnder(
    join(packagesRoot, "skills-loader-core", "src", "features", "builtin-skills"),
  )
  const codexComponentRoots = codexComponentSkillRoots(repoRoot)
  const engineRoots = senpiEngineSkillRoots(repoRoot)
  const agentsLocalRoots = skillRootsUnder(join(repoRoot, ".agents", "skills"))
  const opencodeLocalRoots = skillRootsUnder(join(repoRoot, ".opencode", "skills"))

  const skillRoots = new Map<string, string[]>()
  const addRoot = (root: string, name = readSkillName(join(root, "SKILL.md"))) => {
    skillRoots.set(name, [...(skillRoots.get(name) ?? []), root])
    return name
  }
  const sharedSkills = sharedRoots.map((root) => addRoot(root))
  const nativeSenpiSkills = nativeSources.map((source) => addRoot(source.source, source.name))
  const xSearch = addRoot(xSearchRoot)
  const loaderBuiltinSkills = loaderBuiltinRoots.map((root) => addRoot(root))
  const codexComponentSkills = codexComponentRoots.map((root) => addRoot(root))
  const engineSkills = engineRoots.map((root) => addRoot(root))
  const agentsLocalSkills = agentsLocalRoots.map((root) => addRoot(root))
  const opencodeLocalSkills = opencodeLocalRoots.map((root) => addRoot(root))

  const senpiSkills = new Set([...sharedSkills, ...nativeSenpiSkills, xSearch, ...engineSkills])
  // `.opencode/skills` here is this repository's own project-local set: OpenCode discovers that directory only in the
  // user's project and config dirs, so it never reaches a user's session and is no part of the shipped catalog.
  const opencodeSkills = new Set([...sharedSkills, ...loaderBuiltinSkills, ...BuiltinSkillNameSchema.options])
  // The Codex sync synthesizes `ultrawork` from the canonical prompts-core directive.
  const codexSkills = new Set([...sharedSkills, ...codexComponentSkills, "ultrawork", ...CODEX_SYSTEM_SKILL_NAMES])

  const senpiAgents = new Set([...BUILTIN_AGENT_NAMES, ...Object.keys(LEGACY_AGENT_NAME_ALIASES)])
  const opencodeAgents = new Set<string>([...BuiltinAgentNameSchema.options, ...OverridableAgentNameSchema.options])
  const codexAgents = new Set([...codexAgentRoleNames(repoRoot), ...CODEX_BUILTIN_AGENT_TYPES])

  const legacyCategories = Object.keys(LEGACY_CATEGORY_NAME_ALIASES)
  const senpiCategories = new Set([...Object.keys(SENPI_CATEGORIES), ...legacyCategories])
  const opencodeCategories = new Set([...Object.keys(OPENCODE_CATEGORIES), ...legacyCategories])

  return {
    skills: {
      senpi: senpiSkills,
      opencode: opencodeSkills,
      codex: codexSkills,
      repo: union(senpiSkills, opencodeSkills, codexSkills, new Set([...agentsLocalSkills, ...opencodeLocalSkills])),
    },
    agents: {
      senpi: senpiAgents,
      opencode: opencodeAgents,
      codex: codexAgents,
      repo: union(senpiAgents, opencodeAgents, codexAgents),
    },
    categories: {
      senpi: senpiCategories,
      opencode: opencodeCategories,
      codex: opencodeCategories,
      repo: union(senpiCategories, opencodeCategories),
    },
    skillRoots,
  }
}

const TEXT_FILE = /\.(md|mdx|txt|mjs|js|ts|json|ya?ml|toml)$/
const NON_SHIPPED_FILE =
  /(?:\.test\.|\.spec\.|(?:^|\/)(?:test|tests|__tests__|fixtures)\/|(?:^|\/)ATTRIBUTION\.md$|(?:^|\/)EVIDENCE\.md$|(?:^|\/)changes\.md$|(?:^|\/)CHANGELOG\.md$)/

function auditedTree(
  repoRoot: string,
  root: string,
  editions: readonly Edition[],
  taskDialect: AuditedFile["taskDialect"],
  skillRoot: string | undefined,
): AuditedFile[] {
  return listFilesRecursive(root)
    .filter((file) => TEXT_FILE.test(file) && !NON_SHIPPED_FILE.test(toPortable(relative(repoRoot, file))))
    .map((path) => ({ path, editions, skillRoot, taskDialect }))
}

/** Every shipped skill tree and prompt directory, tagged with the editions that ship it. */
function collectAuditedFiles(repoRoot: string): AuditedFile[] {
  const packagesRoot = join(repoRoot, "packages")
  const files: AuditedFile[] = []

  const nativeSources = createNativeSkillSources(packagesRoot).sources
  const nativeByName = new Map(nativeSources.map((source) => [source.name, source]))

  const sharedRoot = join(packagesRoot, "shared-skills", "skills")
  for (const skillRoot of skillRootsUnder(sharedRoot)) {
    const native = nativeByName.get(basename(skillRoot))
    for (const file of auditedTree(repoRoot, skillRoot, ["opencode", "codex"], "opencode", skillRoot)) {
      // A Senpi-native override replaces the shared skill; only its listed shared assets still ship there.
      const portable = toPortable(relative(skillRoot, file.path))
      // Third-party corpora are materialized byte for byte from pinned upstreams at build time; their own
      // README maps the upstream skills they name, and this audit covers only text this repository authors.
      if (thirdPartyFrontendPaths.has(toPortable(relative(frontendSkillRoot, file.path)))) continue
      const shipsToSenpi =
        native === undefined ||
        (native.sharedAssets ?? []).some((asset) => portable === asset || portable.startsWith(`${asset}/`))
      files.push({ ...file, editions: shipsToSenpi ? ["opencode", "codex", "senpi"] : ["opencode", "codex"] })
    }
  }

  for (const source of nativeSources) {
    files.push(...auditedTree(repoRoot, source.source, ["senpi"], "senpi", source.source))
  }
  const xSearchRoot = join(packagesRoot, "omo-senpi", "src", "components", "x-search", "skill")
  files.push(...auditedTree(repoRoot, xSearchRoot, ["senpi"], "senpi", xSearchRoot))

  for (const skillRoot of codexComponentSkillRoots(repoRoot)) {
    files.push(...auditedTree(repoRoot, skillRoot, ["codex"], "codex", skillRoot))
  }

  const loaderBuiltinRoot = join(packagesRoot, "skills-loader-core", "src", "features", "builtin-skills")
  for (const skillRoot of skillRootsUnder(loaderBuiltinRoot)) {
    // A builtin named like a shared skill is its checked-in byte copy; OpenCode serves the shared file.
    if (existsSync(join(sharedRoot, basename(skillRoot)))) continue
    files.push(...auditedTree(repoRoot, skillRoot, ["opencode"], "opencode", skillRoot))
  }

  for (const localRoot of [join(repoRoot, ".agents", "skills"), join(repoRoot, ".opencode", "skills")]) {
    for (const skillRoot of skillRootsUnder(localRoot)) {
      files.push(...auditedTree(repoRoot, skillRoot, ["repo"], "opencode", skillRoot))
    }
  }

  const promptsRoot = join(packagesRoot, "prompts-core", "prompts")
  for (const file of auditedTree(repoRoot, promptsRoot, ["opencode"], "opencode", undefined)) {
    files.push(basename(file.path) === "codex.md" ? { ...file, editions: ["codex"], taskDialect: "codex" } : file)
  }

  // Agent prompts written in TypeScript: OpenCode's agents and the Senpi task engine's builtin agents.
  for (const [agentsRoot, edition] of [
    [join(packagesRoot, "omo-opencode", "src", "agents"), "opencode"],
    [join(packagesRoot, "senpi-task", "src", "agents"), "senpi"],
  ] as const) {
    for (const path of listFilesRecursive(agentsRoot)) {
      if (!path.endsWith(".ts") || NON_SHIPPED_FILE.test(toPortable(relative(repoRoot, path)))) continue
      files.push({ path, editions: [edition], skillRoot: undefined, taskDialect: edition })
    }
  }

  const senpiComponentsRoot = join(packagesRoot, "omo-senpi", "src", "components")
  for (const path of listFilesRecursive(senpiComponentsRoot)) {
    if (!path.endsWith(".md") || basename(path) === "AGENTS.md" || path.startsWith(xSearchRoot)) continue
    if (NON_SHIPPED_FILE.test(toPortable(relative(repoRoot, path)))) continue
    files.push({ path, editions: ["senpi"], skillRoot: undefined, taskDialect: "senpi" })
  }

  return files
}

interface RawReference {
  readonly referenceClass: ReferenceClass
  readonly reference: string
  readonly index: number
}

const LOAD_SKILLS_LIST = /load_skills["']?\s*[=:]\s*\[([^\]\n]*)\]/g
const QUOTED = /["']([^"'\s]+)["']/g
const SKILL_TOOL_CALL = /\bskill\s*\(\s*(?:name\s*[=:]\s*)?["']([^"']+)["']/g
const SLASH_SKILL = /\/skill:([A-Za-z0-9][A-Za-z0-9_-]*)/g
const SKILL_FILE_PATH = /(?:^|[\s`'"(/])skills\/([A-Za-z0-9][A-Za-z0-9_-]*)\/SKILL\.md/g
const BACKTICK_THEN_SKILL = /`\/?([a-z0-9][a-z0-9_-]*)`\s+skill\b/g
const SKILL_THEN_BACKTICK = /\b[Ss]kill\s+`\/?([a-z0-9][a-z0-9_-]*)`/g
const SUBAGENT_TYPE = /["']?subagent_type["']?\s*[=:]\s*["']([A-Za-z0-9_.-]+)["']/g
const AGENT_TYPE = /(?<![A-Za-z_])["']?agent_type["']?\s*[=:]\s*["']([A-Za-z0-9_.-]+)["']/g
const CATEGORY = /["']?category["']?\s*[=:]\s*["']([A-Za-z0-9_.-]+)["']/g
const TASK_CALL_OPEN = /\b(?:task|call_omo_agent|delegate_task)\s*\(/g
const SKILL_RELATIVE_PATH = /`(\.{1,2}\/[^`\s]+\.md|(?:references|scripts|assets|templates)\/[^`\s]+)`/g
const SKILL_OWNER = /`([a-z0-9][a-z0-9-]*)`(?:'s\b|\s+skill\b)|\bload\s+`([a-z0-9][a-z0-9-]*)`/g
// A conditional mention of a skill the user's own project may define ("some repositories define one project-locally") names no shipped target.
const PROJECT_LOCAL_MENTION = /\bproject[- ]local(?:ly)?\b/i
const CONDITIONAL_WORD = /\b(?:when|whenever|if|where|unless)\b/i
// An optional mention names availability of the skill or of a harness surface, never a generic "has": "when the \`x\`
// skill is available", "if the session lists the \`x\` skill", "where the harness has a dependency-graph surface".
const AVAILABILITY_WORD =
  /\b(?:is available|are available|is listed|are listed|lists|provides|is installed|is (?:driving|active|running|enabled))\b|\b(?:session|harness|environment|runtime)\b[^.]{0,60}\b(?:has|have|gives|provides)\b/i

function taskCallBodies(content: string): { readonly start: number; readonly body: string }[] {
  const bodies: { start: number; body: string }[] = []
  for (const match of content.matchAll(TASK_CALL_OPEN)) {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let end = start
    while (end < content.length && end - start < 4000 && depth > 0) {
      const char = content[end]
      if (char === "(") depth += 1
      else if (char === ")") depth -= 1
      end += 1
    }
    bodies.push({ start, body: content.slice(start, end) })
  }
  return bodies
}

function extractReferences(content: string): RawReference[] {
  const references: RawReference[] = []
  const push = (referenceClass: ReferenceClass, reference: string, index: number) =>
    references.push({ referenceClass, reference, index })

  for (const match of content.matchAll(LOAD_SKILLS_LIST)) {
    const listStart = (match.index ?? 0) + match[0].indexOf("[") + 1
    for (const quoted of (match[1] ?? "").matchAll(QUOTED)) {
      push("skill-name", quoted[1] ?? "", listStart + (quoted.index ?? 0))
    }
  }
  for (const pattern of [SKILL_TOOL_CALL, SLASH_SKILL, SKILL_FILE_PATH, BACKTICK_THEN_SKILL, SKILL_THEN_BACKTICK]) {
    for (const match of content.matchAll(pattern)) push("skill-name", match[1] ?? "", match.index ?? 0)
  }
  for (const match of content.matchAll(SUBAGENT_TYPE)) push("agent-name", match[1] ?? "", match.index ?? 0)
  for (const match of content.matchAll(AGENT_TYPE)) push("agent-name", `agent_type:${match[1] ?? ""}`, match.index ?? 0)
  for (const { start, body } of taskCallBodies(content)) {
    for (const match of body.matchAll(CATEGORY)) push("category-name", match[1] ?? "", start + (match.index ?? 0))
  }
  for (const match of content.matchAll(SKILL_RELATIVE_PATH)) push("skill-path", match[1] ?? "", match.index ?? 0)
  return references
}

function normalizeSeparators(name: string): string {
  return name.toLowerCase().replaceAll("_", "-").replace(/-{2,}/g, "-")
}

/** Optimal-string-alignment distance (Damerau-Levenshtein with adjacent transpositions). */
function editDistance(left: string, right: string): number {
  const table: number[][] = Array.from({ length: left.length + 1 }, (_, row) =>
    Array.from({ length: right.length + 1 }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  )
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      let best = Math.min(table[row - 1][column] + 1, table[row][column - 1] + 1, table[row - 1][column - 1] + cost)
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        best = Math.min(best, table[row - 2][column - 2] + 1)
      }
      table[row][column] = best
    }
  }
  return table[left.length][right.length]
}

/**
 * The closest real name: an exact match after `-`/`_`/case normalization wins, otherwise the nearest
 * name within an edit distance of 2 (1 for names of 4 characters or fewer), ties broken alphabetically.
 */
export function suggestName(reference: string, candidates: Iterable<string>): string | undefined {
  const sorted = [...new Set(candidates)].sort()
  const normalized = normalizeSeparators(reference)
  const separatorMatch = sorted.find((candidate) => normalizeSeparators(candidate) === normalized)
  if (separatorMatch !== undefined) return separatorMatch
  const limit = normalized.length <= 4 ? 1 : 2
  let best: { name: string; distance: number } | undefined
  for (const candidate of sorted) {
    const distance = editDistance(normalized, normalizeSeparators(candidate))
    if (distance <= limit && (best === undefined || distance < best.distance)) best = { name: candidate, distance }
  }
  return best?.name
}

/**
 * The closest real file under `root`: the same basename in the referencing file's own directory
 * first, then a unique basename anywhere in the skill, then the nearest path within 3 edits.
 */
function suggestPath(root: string, fromDirectory: string, reference: string): string | undefined {
  const target = (reference.split("#", 1)[0] ?? reference).replace(/^\.\//, "")
  const candidates = listFilesRecursive(root).map((file) => toPortable(relative(root, file)))
  const sameName = candidates.filter((candidate) => basename(candidate) === basename(target))
  const local = toPortable(relative(root, fromDirectory))
  const sameDirectory = sameName.filter((candidate) => dirname(candidate) === local)
  if (sameDirectory.length === 1) return sameDirectory[0]
  if (sameName.length === 1) return sameName[0]
  let best: { path: string; distance: number } | undefined
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate)
    if (distance <= 3 && (best === undefined || distance < best.distance)) best = { path: candidate, distance }
  }
  return best?.path
}

function lineBounds(content: string, index: number): { readonly start: number; readonly end: number } {
  const start = content.lastIndexOf("\n", index - 1) + 1
  const newline = content.indexOf("\n", index)
  return { start, end: newline === -1 ? content.length : newline }
}

function lineNumber(content: string, index: number): number {
  let line = 1
  for (
    let cursor = content.indexOf("\n");
    cursor !== -1 && cursor < index;
    cursor = content.indexOf("\n", cursor + 1)
  ) {
    line += 1
  }
  return line
}

function sentenceAround(content: string, index: number): string {
  const { start, end } = lineBounds(content, index)
  const line = content.slice(start, end)
  const offset = index - start
  const before = line.slice(0, offset)
  const lastBoundary = before.search(/[.!?]\s(?!.*[.!?]\s)/)
  const sentenceStart = lastBoundary === -1 ? 0 : lastBoundary + 2
  const afterMatch = line.slice(offset).search(/[.!?](?:\s|$)/)
  return line.slice(sentenceStart, afterMatch === -1 ? line.length : offset + afterMatch + 1)
}

function isOptionalMention(content: string, index: number): boolean {
  const sentence = sentenceAround(content, index)
  return CONDITIONAL_WORD.test(sentence) && AVAILABILITY_WORD.test(sentence)
}

/** The skill a relative path belongs to when the prose names one just before it (`x` skill's / `x`'s). */
function owningSkill(content: string, index: number): string | undefined {
  const paragraphStart = Math.max(content.lastIndexOf("\n\n", index), index - 600, 0)
  const window = content.slice(paragraphStart, index)
  let owner: string | undefined
  for (const match of window.matchAll(SKILL_OWNER)) owner = match[1] ?? match[2]
  return owner
}

function isTemplated(reference: string): boolean {
  return /[<>{}*$[\]|]|\.\.\./.test(reference)
}

function cleanPath(reference: string): string {
  return (reference.split("#", 1)[0] ?? "").replace(/[),.:;]+$/, "")
}

const thirdPartyFrontendPaths: ReadonlySet<string> = new Set([
  ...thirdPartyRelativePaths(),
  ...designpowersThirdPartyRelativePaths(),
])
const materializedFrontendPaths: ReadonlySet<string> = new Set([
  ...thirdPartyFrontendPaths,
  ...keptDesignRelativePaths(),
])

function resolvesUnder(root: string, reference: string): boolean {
  const target = cleanPath(reference)
  if (target.length === 0) return false
  if (existsSync(resolve(root, target))) return true
  // Third-party frontend references are materialized into the package at build time (see the skill's .gitignore).
  const fromFrontend = toPortable(relative(frontendSkillRoot, resolve(root, target)))
  return (
    materializedFrontendPaths.has(fromFrontend) ||
    [...materializedFrontendPaths].some((path) => path.startsWith(`${fromFrontend.replace(/\/$/, "")}/`))
  )
}

function catalogFor(
  catalog: ReferenceCatalog,
  referenceClass: Exclude<ReferenceClass, "skill-path">,
): Readonly<Record<Edition, ReadonlySet<string>>> {
  if (referenceClass === "skill-name") return catalog.skills
  if (referenceClass === "agent-name") return catalog.agents
  return catalog.categories
}

/**
 * Shared skills are written in the OpenCode dialect and the Senpi and Codex syncs translate their
 * `task(...)` examples (the synced Senpi output is checked by omo-senpi's skills-sync test), so a
 * target there must be real in OpenCode or Senpi. A Codex `agent_type` must be a Codex role.
 */
function taskTargetAccepted(
  file: AuditedFile,
  catalog: ReferenceCatalog,
  kind: "agent-name" | "category-name",
  name: string,
  isAgentType: boolean,
): boolean {
  const byEdition = catalogFor(catalog, kind)
  if (isAgentType) return byEdition.codex.has(name)
  if (file.editions.includes("repo")) return byEdition.repo.has(name)
  if (file.taskDialect === "senpi") return byEdition.senpi.has(name)
  return byEdition.opencode.has(name) || byEdition.senpi.has(name)
}

function auditSkillPath(
  file: AuditedFile,
  catalog: ReferenceCatalog,
  content: string,
  raw: RawReference,
  editions: readonly Edition[],
): Omit<ReferenceFinding, "file" | "line"> | undefined {
  if (file.skillRoot === undefined || isTemplated(raw.reference)) return undefined
  const owner = owningSkill(content, raw.index)
  const ownerRoots = owner === undefined ? [] : (catalog.skillRoots.get(owner) ?? [])
  if (ownerRoots.length > 0) {
    if (ownerRoots.some((root) => resolvesUnder(root, raw.reference))) return undefined
    return {
      referenceClass: "skill-path",
      reference: `${owner}:${raw.reference}`,
      missingIn: editions,
      suggestion: suggestPath(ownerRoots[0] ?? "", ownerRoots[0] ?? "", raw.reference),
    }
  }
  if (resolvesUnder(file.skillRoot, raw.reference) || resolvesUnder(dirname(file.path), raw.reference)) return undefined
  return {
    referenceClass: "skill-path",
    reference: raw.reference,
    missingIn: editions,
    suggestion: suggestPath(file.skillRoot, dirname(file.path), raw.reference),
  }
}

function auditFile(file: AuditedFile, catalog: ReferenceCatalog, repoRoot: string): ReferenceFinding[] {
  const content = readFileSync(file.path, "utf8")
  const findings: ReferenceFinding[] = []
  const relativePath = toPortable(relative(repoRoot, file.path))

  for (const raw of extractReferences(content)) {
    const editions = file.editions
    const at = { file: relativePath, line: lineNumber(content, raw.index) }

    if (raw.referenceClass === "skill-path") {
      const finding = auditSkillPath(file, catalog, content, raw, editions)
      if (finding !== undefined) findings.push({ ...at, ...finding })
      continue
    }

    const isAgentType = raw.reference.startsWith("agent_type:")
    const name = isAgentType ? raw.reference.slice("agent_type:".length) : raw.reference
    if (PLACEHOLDER_NAMES.has(name) || isTemplated(name) || !SKILL_NAME_SHAPE.test(name)) continue
    const byEdition = catalogFor(catalog, raw.referenceClass)

    if (raw.referenceClass !== "skill-name") {
      if (taskTargetAccepted(file, catalog, raw.referenceClass, name, isAgentType)) continue
      const checked: readonly Edition[] = isAgentType
        ? ["codex"]
        : file.editions.includes("repo")
          ? ["repo"]
          : [file.taskDialect]
      findings.push({
        ...at,
        referenceClass: raw.referenceClass,
        reference: name,
        missingIn: checked,
        suggestion: suggestName(
          name,
          checked.flatMap((edition) => [...byEdition[edition]]),
        ),
      })
      continue
    }

    const optional = isOptionalMention(content, raw.index)
    const missingIn = optional
      ? SHIPPED_EDITIONS.some((edition) => byEdition[edition].has(name)) ||
        PROJECT_LOCAL_MENTION.test(sentenceAround(content, raw.index)) ||
        (editions.includes("repo") && byEdition.repo.has(name))
        ? []
        : editions
      : editions.filter((edition) => !byEdition[edition].has(name))
    if (missingIn.length === 0) continue
    findings.push({
      ...at,
      referenceClass: "skill-name",
      reference: name,
      missingIn,
      suggestion: suggestName(
        name,
        missingIn.flatMap((edition) => [...byEdition[edition]]),
      ),
    })
  }
  return findings
}

interface AuditOptions {
  readonly catalog?: ReferenceCatalog
  readonly files?: readonly AuditedFile[]
}

export function auditSkillReferences(repoRoot: string, options: AuditOptions = {}): ReferenceFinding[] {
  const catalog = options.catalog ?? buildReferenceCatalog(repoRoot)
  const files = options.files ?? collectAuditedFiles(repoRoot)
  return files
    .flatMap((file) => auditFile(file, catalog, repoRoot))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)
}

export function formatFinding(finding: ReferenceFinding): string {
  const hint = finding.suggestion === undefined ? "" : ` (did you mean "${finding.suggestion}"?)`
  return `${finding.file}:${finding.line}: ${finding.referenceClass} "${finding.reference}" resolves to nothing in ${finding.missingIn.join(", ")}${hint}`
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "..")
  const findings = auditSkillReferences(repoRoot)
  for (const finding of findings) console.error(formatFinding(finding))
  console.log(`SKILL_REFERENCE_AUDIT findings=${findings.length}`)
  process.exit(findings.length === 0 ? 0 : 1)
}
