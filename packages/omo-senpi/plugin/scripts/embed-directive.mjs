#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "../..")
const repoRoot = resolve(packageRoot, "../..")
const sourcePath = resolve(repoRoot, "packages/omo-codex/plugin/components/ultrawork/directive.md")
const targetPath = resolve(packageRoot, "src/components/ultrawork/generated-directive.ts")

const forbiddenDirectiveTokens = [
  "create_goal",
  "complete_goal",
  "add_subgoal",
  "update_plan",
  "multi_agent",
  "spawn_agent",
]

const forbiddenPatterns = [
  ...forbiddenDirectiveTokens.map((token) => new RegExp(token, "i")),
  /browser:control-in-app-browser/i,
  /Codex Browser plugin/i,
  /Browser plugin/i,
]

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function splitBlocks(value) {
  return normalizeNewlines(value).split(/\n{2,}/)
}

export function transformDirective(rawDirective) {
  const keptBlocks = []
  for (const block of splitBlocks(rawDirective)) {
    if (forbiddenPatterns.some((pattern) => pattern.test(block))) {
      continue
    }
    keptBlocks.push(block.trim())
  }

  return `${keptBlocks.filter((block) => block.length > 0).join("\n\n").trim()}\n`
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
  const expected = readExpectedModule()
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
