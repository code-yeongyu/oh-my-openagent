#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "../..")
const repoRoot = resolve(packageRoot, "../..")
const sourcePath = resolve(repoRoot, "packages/omo-senpi/skills/ultrawork/SKILL.md")
const targetPath = resolve(packageRoot, "src/components/ultrawork/generated-directive.ts")

// The directive is authored senpi-native (skills/ultrawork/SKILL.md) and senpi HAS
// goal/todo/task/team tools, so the source speaks them directly. These tokens name
// harness surfaces senpi does not have; any match means other-edition text leaked in,
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

export function transformDirective(rawSkill) {
  const body = extractSkillBody(rawSkill)
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

  return `${body.trim()}\n`
}

function renderGeneratedModule(directive) {
  return [
    "export const FORBIDDEN_DIRECTIVE_TOKENS = [",
    ...forbiddenDirectiveTokens.map((token) => `  ${JSON.stringify(token)},`),
    "] as const",
    "",
    `export const SENPI_ULTRAWORK_DIRECTIVE = ${JSON.stringify(directive)} as const`,
    "",
  ].join("\n")
}

function readExpectedModule() {
  return renderGeneratedModule(transformDirective(readFileSync(sourcePath, "utf8")))
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

main(process.argv.slice(2))
