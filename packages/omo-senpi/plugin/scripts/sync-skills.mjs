#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createSkillSourceCopyFilter } from "@oh-my-opencode/shared-skills/skill-source-filter"
import { createNativeSkillSources } from "./native-skill-sources.mjs"
import { insertSenpiCompatibilityGuidance } from "./senpi-compatibility-guidance.mjs"
import { applySenpiSkillRosterOverlay } from "./senpi-skill-roster-overlay.mjs"

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(pluginRoot))
const skillsRoot = process.env.OMO_SENPI_PLUGIN_OUTPUT === undefined
  ? join(pluginRoot, "skills")
  : join(process.env.OMO_SENPI_PLUGIN_OUTPUT, "skills")
const sharedSkillsRoot = join(repoRoot, "shared-skills", "skills")

const skillSources = [
  {
    name: "ulw-loop",
    source: join(repoRoot, "omo-senpi", "skills", "ulw-loop"),
  },
]
const componentSkillNames = new Set(skillSources.map(({ name }) => name))

const { sources: nativeSkillSources, names: nativeSkillNames } = createNativeSkillSources(repoRoot)

const textExtensions = new Set([".md", ".yaml", ".yml", ".json", ".txt"])
const sectionHeadingsToStrip = new Set([
  "Codex Harness Tool Compatibility",
  "Codex Tool Mapping",
  "Codex subagent reliability",
  "Codex Subagent Reliability",
  "Subagent-dependent transition barrier",
  "Senpi Harness Tool Compatibility",
])
const forbiddenGuidancePattern = /\b(?:multi_agent|spawn_agent|update_plan)\b/i


/** senpi additionally excludes the generated Codex agent manifest from packaged skills. */
const senpiFilterOptions = { ignoredFileNames: ["openai.yaml"] }

function isTextFile(path) {
  return textExtensions.has(extname(path))
}

function rewriteEditionNaming(content) {
  return content
    .replace(/\bon Codex\b/g, "for omo-senpi")
    .replace(/\bIn Codex\b/g, "In omo-senpi")
    .replace(/\bCodex App\b/g, "omo-senpi")
    .replace(/\bCodex CLI\b/g, "omo-senpi")
    .replace(/\bCodex\b/g, "omo-senpi")
    .replace(/\bcodex\b/g, "omo-senpi")
    .replace(/\blazycodex\b/g, "omo-senpi")
    .replace(/\bLazyCodex\b/g, "omo-senpi")
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

function applyUlwExecuteOverlay(content) {
  return content.replace(/codex:<session_id>/g, "senpi:<session_id>").replace(/\bcodex:/g, "senpi:")
}

function applySharedTierAdaptation(skillName, content) {
  let adapted = applySenpiSkillRosterOverlay(skillName, content)
  if (skillName === "ulw-execute") {
    adapted = applyUlwExecuteOverlay(adapted)
  }
  adapted = stripNamedSections(adapted)
  adapted = stripForbiddenGuidanceLines(adapted)
  adapted = insertSenpiCompatibilityGuidance(adapted)
  return normalizeBlankLines(adapted)
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
    await cp(source, destination, { filter: createSkillSourceCopyFilter(source, senpiFilterOptions), recursive: true })
    await adaptSkillTree(destination, normalizeBlankLines)
  }

  for (const { name, source } of nativeSkillSources) {
    await assertSourceExists(source)
    const destination = join(skillsRoot, name)
    await cp(source, destination, { filter: createSkillSourceCopyFilter(source, senpiFilterOptions), recursive: true })
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
    await cp(source, destination, { filter: createSkillSourceCopyFilter(source, senpiFilterOptions), recursive: true })
    await adaptSkillTree(destination, (content) => applySharedTierAdaptation(skillName, content))
  }

  console.log(`synced omo-senpi skills to ${skillsRoot}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncSkills()
}
