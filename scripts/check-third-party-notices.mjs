#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const CODEGRAPH_COMPONENTS = [
  "@colbymchenry/codegraph",
  "@colbymchenry/codegraph-darwin-arm64",
  "@colbymchenry/codegraph-darwin-x64",
  "@colbymchenry/codegraph-linux-arm64",
  "@colbymchenry/codegraph-linux-x64",
  "@colbymchenry/codegraph-win32-arm64",
  "@colbymchenry/codegraph-win32-x64",
  "CodeGraph bundled Node.js runtime",
  "tree-sitter-wasms",
  "web-tree-sitter",
  "@clack/core",
  "fast-string-truncated-width",
  "fast-string-width",
  "fast-wrap-ansi",
  "ignore",
  "sisteransi",
]

const ROOT_BUNDLED_COMPONENTS = [
  "@ast-grep/cli binary payload",
  "pi-lsp-client",
  "pi-rules",
  "pi-comment-checker",
  ...CODEGRAPH_COMPONENTS,
]

const scopes = {
  root: {
    noticePath: "THIRD-PARTY-NOTICES.md",
    requiredComponents() {
      const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
      return [...Object.keys(packageJson.dependencies ?? {}), ...ROOT_BUNDLED_COMPONENTS]
    },
  },
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function headingExists(noticeText, component) {
  const pattern = new RegExp(`^###\\s+${escapeRegExp(component)}(?:@|\\s|\\(|$)`, "im")
  return pattern.test(noticeText)
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function runScope(scopeName) {
  const scope = scopes[scopeName]
  if (!scope) {
    console.error(`Unsupported notice scope: ${scopeName}`)
    process.exitCode = 2
    return
  }

  const resolvedNoticePath = join(repoRoot, scope.noticePath)
  if (!existsSync(resolvedNoticePath)) {
    console.error(`${scope.noticePath} is missing`)
    process.exitCode = 1
    return
  }

  const noticeText = readFileSync(resolvedNoticePath, "utf8")
  const requiredComponents = unique(scope.requiredComponents())
  const missing = requiredComponents.filter((component) => !headingExists(noticeText, component))

  if (missing.length > 0) {
    console.error(`${scope.noticePath} is missing ${missing.length} required notice entries:`)
    for (const component of missing) console.error(`- ${component}`)
    process.exitCode = 1
    return
  }

  console.log(`${scope.noticePath}: ${requiredComponents.length} required notice entries present`)
}

const args = process.argv.slice(2)
if (args.includes("--codex")) {
  console.error("--codex notice checks are reserved for task 6")
  process.exit(2)
}

runScope("root")
