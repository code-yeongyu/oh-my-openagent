#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "../..")
const targetPath = resolve(packageRoot, "src/components/ultrawork/generated-directive.ts")

// Each ultrawork variant is one complete prompt authored in its own file (#14441): the default in
// skills/ultrawork/SKILL.md (its body is also what `/skill:ultrawork` expands) and the GPT one in
// skills/ultrawork/references/gpt.md. No variant is derived from another, so a sentence of one can
// never leak into the other. `export` is the constant the generated module gives the variant.
const VARIANT_SOURCES = [
  { name: "default", path: "skills/ultrawork/SKILL.md", export: "SENPI_ULTRAWORK_DIRECTIVE" },
  { name: "gpt", path: "skills/ultrawork/references/gpt.md", export: "SENPI_GPT_ULTRAWORK_DIRECTIVE" },
]

const MODE_OPEN_TAG = "<ultrawork-mode>"
const MODE_CLOSE_TAG = "</ultrawork-mode>"

// The directives are authored senpi-native and senpi HAS goal/todo/task/team tools, so the
// sources speak them directly. These tokens name harness surfaces senpi does not have (or no
// longer has); any match means other-edition text leaked in, and the build MUST fail loudly —
// silently stripping blocks is how the old codex-derived pipeline shipped mangled sentences.
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

function stripFrontmatter(raw) {
  const normalized = normalizeNewlines(raw)
  const frontmatter = normalized.match(/^---\n[\s\S]*?\n---\n+/)
  return frontmatter === null ? normalized : normalized.slice(frontmatter[0].length)
}

function assertNoForbiddenTokens(name, body) {
  const violations = []
  for (const block of body.split(/\n{2,}/)) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(block)) {
        violations.push(`/${pattern.source}/i: ${block.trim().slice(0, 120)}`)
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `senpi ultrawork ${name} directive source contains forbidden non-senpi tokens:\n  - ${violations.join("\n  - ")}`,
    )
  }
}

// The component finds a delivered directive by its one `<ultrawork-mode>` pair, so a source that
// opens or closes the block more than once, or leaves text outside it, would ship a prompt the
// component cannot recognize.
function assertOneModeBlock(name, body) {
  const opens = body.split(MODE_OPEN_TAG).length - 1
  const closes = body.split(MODE_CLOSE_TAG).length - 1
  if (opens !== 1 || closes !== 1 || !body.startsWith(MODE_OPEN_TAG) || !body.endsWith(MODE_CLOSE_TAG)) {
    throw new Error(
      `senpi ultrawork ${name} directive source must be exactly one ${MODE_OPEN_TAG} block (found ${opens} open, ${closes} close)`,
    )
  }
}

/** One variant's directive: its source without frontmatter, validated, ending in one newline. */
export function transformDirective(name, rawSource) {
  const body = stripFrontmatter(rawSource).trim()
  assertOneModeBlock(name, body)
  assertNoForbiddenTokens(name, body)
  return `${body}\n`
}

/** Every variant's directive, keyed by variant name, derived from the shipped sources. */
export function readDirectives() {
  return Object.fromEntries(
    VARIANT_SOURCES.map((variant) => [
      variant.name,
      transformDirective(variant.name, readFileSync(resolve(packageRoot, variant.path), "utf8")),
    ]),
  )
}

function renderGeneratedModule(directives) {
  return [
    "export const FORBIDDEN_DIRECTIVE_TOKENS = [",
    ...forbiddenDirectiveTokens.map((token) => `  ${JSON.stringify(token)},`),
    "] as const",
    "",
    "// One whole prompt per variant, embedded from its own source file by plugin/scripts/embed-directive.mjs.",
    ...VARIANT_SOURCES.flatMap((variant) => [
      `// ${variant.name}: ${variant.path}`,
      `export const ${variant.export} = ${JSON.stringify(directives[variant.name])}`,
      "",
    ]),
  ].join("\n")
}

function main(argv) {
  let expected
  try {
    expected = renderGeneratedModule(readDirectives())
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
