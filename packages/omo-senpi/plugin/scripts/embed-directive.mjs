#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "../..")
const repoRoot = resolve(packageRoot, "../..")
const sourcePath = resolve(repoRoot, "packages/omo-senpi/skills/ultrawork/SKILL.md")
const astraVariantPath = resolve(packageRoot, "skills/ultrawork/references/astra-variant.md")
const targetPath = resolve(packageRoot, "src/components/ultrawork/generated-directive.ts")

// A marker pair names one block of the baseline directive that the GPT-6 Astra variant replaces.
// Marker lines sit alone on their line, so stripping them gives the baseline back byte for byte;
// the Astra variant swaps each block for the `## <name>` section of astra-variant.md, and an
// empty section cuts the block. Every block needs a section and every section a block: a stale
// name on either side fails the build instead of shipping a half-applied variant.
const MARKER_PATTERN = /^<!-- omo-ultrawork-astra:([a-z0-9-]+):(start|end) -->\n/gm

// The directive is authored senpi-native (skills/ultrawork/SKILL.md) and senpi HAS
// goal/todo/task/team tools, so the source speaks them directly. These tokens name
// harness surfaces senpi does not have (or no longer has); any match means other-edition text leaked in,
// and the build MUST fail loudly — silently stripping blocks is how the old
// codex-derived pipeline shipped mangled sentences.
const forbiddenDirectiveTokens = [
  "multi_agent",
  "spawn_agent",
  "update_plan",
  "wait_agent",
  "fork_context",
  "fork_turns",
  "codex",
  "wait_for",
]

const forbiddenPatterns = forbiddenDirectiveTokens.map((token) => new RegExp(token, "i"))

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function splitBlocks(value) {
  return normalizeNewlines(value).split(/\n{2,}/)
}

function extractSkillBody(rawSkill) {
  const normalized = normalizeNewlines(rawSkill)
  const frontmatter = normalized.match(/^---\n[\s\S]*?\n---\n+/)
  return frontmatter === null ? normalized : normalized.slice(frontmatter[0].length)
}

/** Ordered, non-nested, uniquely named marker blocks: `{ name, start, end }` offsets into `body`. */
export function parseVariantBlocks(body) {
  const blocks = []
  let open = null
  for (const match of body.matchAll(MARKER_PATTERN)) {
    const [line, name, kind] = match
    if (kind === "start") {
      if (open !== null) throw new Error(`senpi ultrawork directive: marker "${name}" opens inside "${open.name}"`)
      if (blocks.some((block) => block.name === name)) throw new Error(`senpi ultrawork directive: marker "${name}" appears twice`)
      open = { name, markerStart: match.index, contentStart: match.index + line.length }
      continue
    }
    if (open === null || open.name !== name) {
      throw new Error(`senpi ultrawork directive: marker "${name}" closes ${open === null ? "nothing" : `"${open.name}"`}`)
    }
    blocks.push({ ...open, contentEnd: match.index, markerEnd: match.index + line.length })
    open = null
  }
  if (open !== null) throw new Error(`senpi ultrawork directive: marker "${open.name}" never closes`)
  return blocks
}

/** `## <name>` sections of astra-variant.md -> replacement text (empty string cuts the block). */
export function parseVariantSections(rawVariant) {
  const sections = new Map()
  const normalized = normalizeNewlines(rawVariant)
  const headings = [...normalized.matchAll(/^## ([a-z0-9-]+)\n/gm)]
  if (headings.length === 0) throw new Error("senpi ultrawork astra variant has no `## <name>` section")
  if (headings[0].index !== 0) throw new Error("senpi ultrawork astra variant has text before its first `## <name>` section")
  headings.forEach((heading, index) => {
    const name = heading[1]
    if (sections.has(name)) throw new Error(`senpi ultrawork astra variant defines "${name}" twice`)
    const bodyStart = heading.index + heading[0].length
    const bodyEnd = index + 1 < headings.length ? headings[index + 1].index : normalized.length
    const text = normalized.slice(bodyStart, bodyEnd).trim()
    sections.set(name, text === "" ? "" : `${text}\n`)
  })
  return sections
}

function assertNoForbiddenTokens(body) {
  const violations = []
  for (const block of splitBlocks(body)) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(block)) {
        violations.push(`/${pattern.source}/i: ${block.trim().slice(0, 120)}`)
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`senpi ultrawork directive source contains forbidden non-senpi tokens:\n  - ${violations.join("\n  - ")}`)
  }
}

/**
 * Baseline directive (no `astraVariant`): the skill body with every marker line removed.
 * Astra directive (`astraVariant` given): every marked block replaced by its section.
 */
export function transformDirective(rawSkill, astraVariant) {
  const body = extractSkillBody(rawSkill)
  const blocks = parseVariantBlocks(body)
  if (blocks.length === 0) throw new Error("senpi ultrawork directive carries no astra variant markers")
  const sections = astraVariant === undefined ? undefined : parseVariantSections(astraVariant)
  if (sections !== undefined) {
    const blockNames = new Set(blocks.map((block) => block.name))
    const missing = blocks.filter((block) => !sections.has(block.name)).map((block) => block.name)
    const extra = [...sections.keys()].filter((name) => !blockNames.has(name))
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `senpi ultrawork astra variant does not match the marked blocks (missing sections: ${missing.join(", ") || "none"}; sections without a block: ${extra.join(", ") || "none"})`,
      )
    }
  }
  let out = ""
  let cursor = 0
  for (const block of blocks) {
    out += body.slice(cursor, block.markerStart)
    out += sections === undefined ? body.slice(block.contentStart, block.contentEnd) : sections.get(block.name)
    cursor = block.markerEnd
  }
  out += body.slice(cursor)
  // A cut block can leave two blank lines where the list item was; the surrounding prose never does.
  out = out.replace(/\n{3,}/g, "\n\n")
  assertNoForbiddenTokens(out)
  return `${out.trim()}\n`
}

function renderGeneratedModule(directive, astraDirective) {
  return [
    "export const FORBIDDEN_DIRECTIVE_TOKENS = [",
    ...forbiddenDirectiveTokens.map((token) => `  ${JSON.stringify(token)},`),
    "] as const",
    "",
    `export const SENPI_ULTRAWORK_DIRECTIVE = ${JSON.stringify(directive)} as const`,
    "",
    `export const SENPI_ASTRA_ULTRAWORK_DIRECTIVE = ${JSON.stringify(astraDirective)} as const`,
    "",
  ].join("\n")
}

function readExpectedModule() {
  const source = readFileSync(sourcePath, "utf8")
  return renderGeneratedModule(
    transformDirective(source),
    transformDirective(source, readFileSync(astraVariantPath, "utf8")),
  )
}

function main(argv) {
  let expected
  try {
    expected = readExpectedModule()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  if (argv.includes("--check")) {
    const actual = readFileSync(targetPath, "utf8")
    if (actual !== expected) {
      console.error(`generated directive drifted: ${targetPath}`)
      process.exit(1)
    }
    console.log(`generated directive is current: ${targetPath}`)
    return
  }

  writeFileSync(targetPath, expected)
  console.log(`generated ${targetPath}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
