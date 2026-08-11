#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(pluginRoot))
const skillsRoot = join(pluginRoot, "skills")
const sharedSkillsRoot = join(repoRoot, "shared-skills", "skills")

const skillSources = [
  {
    name: "ulw-loop",
    source: join(repoRoot, "omo-omp", "skills", "ulw-loop"),
  },
]
const componentSkillNames = new Set(skillSources.map(({ name }) => name))

// OMP-native skills authored directly against the omo-omp tool surface (not ported from Codex or
// the shared pool). They ship verbatim aside from blank-line normalization: no edition rewrite, no
// section stripping, and no OMP-compatibility banner (they already speak native OMP tools).
const nativeSkillsRoot = join(repoRoot, "omo-omp", "skills")
const nativeSkillSources = [
  {
    name: "give-me-tips",
    source: join(nativeSkillsRoot, "give-me-tips"),
  },
  {
    name: "hyperplan",
    source: join(nativeSkillsRoot, "hyperplan"),
  },
  {
    name: "init-deep",
    source: join(nativeSkillsRoot, "init-deep"),
  },
  {
    name: "ultrawork",
    source: join(nativeSkillsRoot, "ultrawork"),
  },
  {
    // OMP-local override of the shared ulw-plan (omo-opencode consumes the shared file, so the
    // ast-grep/LSP-first rewrite cannot land there). Seeded from the fully omp-adapted bundle
    // output, so it already carries the review-policy overlays and compatibility banner verbatim.
    name: "ulw-plan",
    source: join(nativeSkillsRoot, "ulw-plan"),
  },
  {
    name: "ulw-research",
    source: join(nativeSkillsRoot, "ulw-research"),
  },
]
const nativeSkillNames = new Set(nativeSkillSources.map(({ name }) => name))

const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".txt"])
const sectionHeadingsToStrip = new Set([
  "Codex Harness Tool Compatibility",
  "Codex Tool Mapping",
  "Codex subagent reliability",
  "Codex Subagent Reliability",
  "Subagent-dependent transition barrier",
  "OMP Harness Tool Compatibility",
])
const forbiddenGuidancePattern = /\b(?:multi_agent|spawn_agent)\b/i

const sourceTestFilePattern = /\.test\.ts$/
const ignoredSkillSourceDirNames = new Set([
  ".mypy_cache",
  ".omo",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
])
const ignoredSkillSourceFileNames = new Set([".gitignore", ".npmignore", "pyrightconfig.json", "openai.yaml"])

const opencodeOnlyOrchestrationPattern = /\b(?:call_omo_agent|background_output|team_[a-z_]+|task)\s*\(/

export const ompHarnessToolCompatibility = `## OMP Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In OMP, do not call OpenCode-only tools such as \`call_omo_agent(...)\`, \`task(...)\`, \`background_output(...)\`, or \`team_*(...)\` literally. Translate those examples to OMP native tools:

| OpenCode example | OMP tool to use |
| --- | --- |
| \`call_omo_agent(subagent_type="explore", ...)\` | \`task\` tool with \`subagent_type: "explore"\` |
| \`call_omo_agent(subagent_type="librarian", ...)\` | \`task\` tool with \`subagent_type: "librarian"\` |
| worker/implementation \`task(...)\` | \`task\` tool with \`category\` from the delegation router (\`quick\`, \`unspecified-low\`, \`unspecified-high\`, \`deep\`, \`ultrabrain\`, \`visual-engineering\`, \`writing\`, \`git\`); honor the plan's \`Recommended task executor category:\` line |
| final-review / gate-reviewer \`task(...)\` | fresh \`task\` with \`category: "unspecified-high"\` (or \`"deep"\`) and an adversarial-verifier prompt; \`momus\`/\`metis\` are plan-gated curated reviewers, spawnable only while the plan gate is open |
| \`background_output(task_id="...")\` | \`task_output\` tool with the task id |
| \`team_*(...)\` | Lead team tools (\`team_create\`, \`task_create\`, ...); send with \`task_send\` |
| a watcher on a lane's completion state | \`monitor\` to arm it, \`kill_bash\` to tear it down |

If a code block below conflicts with this section, this section wins.

`

const ompCompatibilityEndMarkers = [
  "If a code block below conflicts with this section, this section wins.\n\n",
]

function isTextFile(path) {
  return textExtensions.has(extname(path))
}

function rewriteEditionNaming(content) {
  return content
    .replace(/\bon Codex\b/g, "for omo-omp")
    .replace(/\bIn Codex\b/g, "In omo-omp")
    .replace(/\bCodex App\b/g, "omo-omp")
    .replace(/\bCodex CLI\b/g, "omo-omp")
    .replace(/\bCodex\b/g, "omo-omp")
    .replace(/\bcodex\b/g, "omo-omp")
    .replace(/\blazycodex\b/g, "omo-omp")
    .replace(/\bLazyCodex\b/g, "omo-omp")
}

function headingLevel(line) {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*$/)
  return match === null ? undefined : match[1].length
}

function headingTitle(line) {
  const match = line.match(/^#{1,6}\s+(.+?)\s*$/)
  return match?.[1]?.replace(/`/g, "").trim()
}

function stripNamedSections(content) {
  const lines = content.split("\n")
  const kept = []
  let strippingLevel

  for (const line of lines) {
    const currentLevel = headingLevel(line)
    if (strippingLevel !== undefined && currentLevel !== undefined && currentLevel <= strippingLevel) {
      strippingLevel = undefined
    }

    if (strippingLevel !== undefined) {
      continue
    }

    const title = headingTitle(line)
    if (title !== undefined && sectionHeadingsToStrip.has(title)) {
      strippingLevel = currentLevel
      continue
    }

    kept.push(line)
  }

  return kept.join("\n")
}

function stripForbiddenGuidanceLines(content) {
  return content
    .split("\n")
    .filter((line) => !forbiddenGuidancePattern.test(line))
    .join("\n")
}

function normalizeBlankLines(content) {
  return content.replace(/\n{3,}/g, "\n\n")
}

function applyTier1Adaptation(content) {
  return normalizeBlankLines(stripForbiddenGuidanceLines(stripNamedSections(rewriteEditionNaming(content))))
}

function applyStartWorkOverlay(content) {
  return content.replace(/codex:<session_id>/g, "omp:<session_id>").replace(/\bcodex:/g, "omp:")
}

const ulwPlanReviewOverride = `## OMP Review Policy (authoritative)

In omo-omp the high-accuracy review is MOMUS-ONLY: one round is exactly ONE native \`momus\` review of the complete plan file, and a momus approval whose remaining items are notes counts as approval.

Only a plan file produced by this skill and recorded with \`review_required\` authorizes a \`momus\` or \`metis\` review. A bare \`ulw\` run without that file uses notepad self-review instead, however large the work feels.

If a section below conflicts with this section, this section wins.

`

const ulwPlanMomusOnlyRewrites = [
  [
    'The high-accuracy review is DUAL and both passes must return OKAY before handoff: (1) the native \`momus\` reviewer subagent, and (2) an independent Oracle review via \`task(subagent_type="oracle", ...)\` on the strongest available reasoning model, in a fully isolated sub-session with normal approval and sandbox policy. Do not add flags that disable approvals or sandboxing.',
    'In omo-omp the high-accuracy review is MOMUS-ONLY: one round is exactly ONE native \`momus\` review of the complete plan file.',
  ],
  ["### High-accuracy review (dual review)", "### High-accuracy review (momus-only in omo-omp)"],
  [
    'One round = exactly ONE \`momus\` + ONE independent review, dispatched together',
    'One round = exactly ONE \`momus\` review, dispatched',
  ],
  ['"independent_reviewer": "oracle",', '"independent_reviewer": null,'],
  ['"lanes": ["momus", "independent"],', '"lanes": ["momus"],'],
  [
    '(all read-only, plus \`oracle\` for the high-accuracy review)',
    '(all read-only; \`momus\` also runs the high-accuracy review)',
  ],
  [
    'the dual high-accuracy review (native \`momus\` + the independent Oracle review) is now REQUIRED',
    'the high-accuracy review (momus-only in omo-omp) is now REQUIRED',
  ],
]

function rewriteUlwPlanReviewToMomusOnly(content) {
  let rewritten = content
  for (const [source, replacement] of ulwPlanMomusOnlyRewrites) {
    rewritten = rewritten.replaceAll(source, replacement)
  }
  return rewritten
}

const ulwPlanConsultationLanes = `## OMP Design Consultation Lanes (authoritative)

When the task tool's available categories include \`architect\` and/or \`ultrabrain\`, ACTIVELY consult them as background advisory lanes while grounding and drafting the plan:

| Lane | Category | Ask it for |
| --- | --- | --- |
| Big-picture design | \`architect\` | module boundaries, decomposition options, trade-offs, blast radius |
| Detail design | \`ultrabrain\` | algorithms, edge cases, exact interfaces and contracts |

Spawn them with \`task(category: "architect" \\| "ultrabrain", run_in_background: true)\` in the same wave as your research lanes, and integrate their answers before the approval brief. Every such prompt MUST start with TASK / DELIVERABLE / SCOPE / VERIFY / STOP WHEN and MUST declare itself advisory-only: read-only analysis, NO file edits, recommendations returned as text. Treat what comes back as claims to verify, not as decisions already made.

This section is an EXPLICIT EXCEPTION to the later rule "Never dispatch with \`category=\`": it authorizes exactly these two advisory lanes. Every other category dispatch stays forbidden. When neither category is listed as available, skip these lanes silently.

`

function applyUlwPlanOverlay(content) {
  const rewritten = rewriteUlwPlanReviewToMomusOnly(content)
  if (rewritten.includes("# ulw-plan - full workflow")) {
    return insertAfterFrontmatter(rewritten, ulwPlanReviewOverride)
  }
  if (/^#\s+ulw-plan\s*$/m.test(rewritten)) {
    return insertAfterFrontmatter(rewritten, `${ulwPlanReviewOverride}${ulwPlanConsultationLanes}`)
  }
  return rewritten
}

function insertAfterFrontmatter(content, section) {
  const frontmatterEnd = content.indexOf("\n---\n", content.startsWith("---\n") ? 4 : 0)
  if (!content.startsWith("---\n") || frontmatterEnd === -1) return `${section}${content}`
  const insertAt = frontmatterEnd + "\n---\n".length
  return `${content.slice(0, insertAt)}\n${section}${content.slice(insertAt)}`
}

function findOMPCompatibilitySectionEnd(content, searchStart) {
  const structuralEndPattern = /\n(?:---|export\s+const\s+|#{1,6}\s)/g
  structuralEndPattern.lastIndex = searchStart
  const structuralEnd = structuralEndPattern.exec(content)
  if (structuralEnd) return structuralEnd.index + 1

  const knownEndMarker = ompCompatibilityEndMarkers.find((marker) => content.indexOf(marker, searchStart) !== -1)
  if (knownEndMarker === undefined) return content.length

  return content.indexOf(knownEndMarker, searchStart) + knownEndMarker.length
}

function removeOMPCompatibilityGuidance(content) {
  const heading = "## OMP Harness Tool Compatibility"
  let withoutGuidance = content

  while (true) {
    const start = withoutGuidance.indexOf(heading)
    if (start === -1) return withoutGuidance

    const end = findOMPCompatibilitySectionEnd(withoutGuidance, start + heading.length)
    withoutGuidance = `${withoutGuidance.slice(0, start)}${withoutGuidance.slice(end)}`
  }
}

function hasKnownGeneratedOMPCompatibilityGuidance(content, compatibilityIndex) {
  return ompCompatibilityEndMarkers.some((marker) => content.indexOf(marker, compatibilityIndex) !== -1)
}

export function insertOMPCompatibilityGuidance(content) {
  if (!opencodeOnlyOrchestrationPattern.test(content)) return content
  const firstExampleIndex = content.search(opencodeOnlyOrchestrationPattern)
  const compatibilityIndex = content.indexOf("## OMP Harness Tool Compatibility")
  if (
    compatibilityIndex !== -1 &&
    compatibilityIndex < firstExampleIndex &&
    !hasKnownGeneratedOMPCompatibilityGuidance(content, compatibilityIndex)
  ) {
    return content
  }

  const contentWithoutGuidance = removeOMPCompatibilityGuidance(content)

  const frontmatterMatch = contentWithoutGuidance.match(/^---\n[\s\S]*?\n---\n+/)
  if (!frontmatterMatch) {
    return `${ompHarnessToolCompatibility}${contentWithoutGuidance}`
  }

  return `${frontmatterMatch[0]}${ompHarnessToolCompatibility}${contentWithoutGuidance.slice(frontmatterMatch[0].length)}`
}

function applySharedTierAdaptation(skillName, content) {
  let adapted = content
  if (skillName === "start-work") {
    adapted = applyStartWorkOverlay(adapted)
  }
  if (skillName === "ulw-plan") {
    adapted = applyUlwPlanOverlay(adapted)
  }
  adapted = stripNamedSections(adapted)
  adapted = stripForbiddenGuidanceLines(adapted)
  adapted = insertOMPCompatibilityGuidance(adapted)
  return normalizeBlankLines(adapted)
}

function shouldCopySkillSource(source) {
  const normalized = source.replaceAll("\\", "/")
  const segments = normalized.split("/")
  const name = segments.at(-1) ?? ""
  if (segments.some((segment) => ignoredSkillSourceDirNames.has(segment))) return false
  if (ignoredSkillSourceFileNames.has(name)) return false
  if (sourceTestFilePattern.test(name) || name.endsWith(".pyc")) return false
  const scriptsIndex = segments.lastIndexOf("scripts")
  return scriptsIndex === -1 || segments[scriptsIndex + 1] !== "tests"
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

async function adaptSkillTree(skillRoot, adapter) {
  const files = await listFiles(skillRoot)
  for (const file of files) {
    if (!isTextFile(file)) continue

    const before = await readFile(file, "utf8")
    const after = adapter(before)
    if (after !== before) {
      await writeFile(file, after, "utf8")
    }
  }
}

async function assertSourceExists(source) {
  const sourceStat = await stat(source)
  if (!sourceStat.isDirectory()) {
    throw new Error(`${source} is not a directory`)
  }
}

export async function syncSkills() {
  await rm(skillsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await mkdir(skillsRoot, { recursive: true })

  for (const { name, source } of skillSources) {
    await assertSourceExists(source)
    const destination = join(skillsRoot, name)
    await cp(source, destination, { filter: shouldCopySkillSource, recursive: true })
    await adaptSkillTree(destination, normalizeBlankLines)
  }

  for (const { name, source } of nativeSkillSources) {
    await assertSourceExists(source)
    const destination = join(skillsRoot, name)
    await cp(source, destination, { filter: shouldCopySkillSource, recursive: true })
    await adaptSkillTree(destination, normalizeBlankLines)
  }

  const sharedSkillEntries = await readdir(sharedSkillsRoot, { withFileTypes: true })
  const sharedSkillNames = sharedSkillEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const skillName of sharedSkillNames) {
    if (componentSkillNames.has(skillName) || nativeSkillNames.has(skillName)) continue
    const source = join(sharedSkillsRoot, skillName)
    const destination = join(skillsRoot, skillName)
    await cp(source, destination, { filter: shouldCopySkillSource, recursive: true })
    await adaptSkillTree(destination, (content) => applySharedTierAdaptation(skillName, content))
  }

  console.log(`synced omo-omp skills to ${skillsRoot}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncSkills()
}
