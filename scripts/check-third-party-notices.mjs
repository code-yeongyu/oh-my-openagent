#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs"
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

const CODEX_AGGREGATE_COMPONENTS = [
  "@ast-grep/cli binary payload",
  "@code-yeongyu/comment-checker",
  "@code-yeongyu/codex-comment-checker",
  "@code-yeongyu/codex-lsp",
  "@code-yeongyu/codex-rules",
  "@code-yeongyu/codex-start-work-continuation",
  "@code-yeongyu/codex-telemetry",
  "@code-yeongyu/codex-ultrawork",
  "@code-yeongyu/codex-ulw-loop",
  "@code-yeongyu/lsp-daemon",
  "@code-yeongyu/lsp-tools-mcp",
  "@oh-my-opencode/ast-grep-mcp",
  "@oh-my-opencode/boulder-state",
  "@oh-my-opencode/comment-checker-core",
  "@oh-my-opencode/git-bash-mcp",
  "@oh-my-opencode/prompts-core",
  "@oh-my-opencode/rules-engine",
  "@oh-my-opencode/shared-skills",
  "@oh-my-opencode/telemetry-core",
  "@oh-my-opencode/utils",
  "@sisyphuslabs/codex-bootstrap",
  "@sisyphuslabs/codex-git-bash-hook",
  "@sisyphuslabs/omo-codex-plugin",
  "Node.js runtime bootstrap payload",
  "pi-comment-checker",
  "pi-lsp-client",
  "pi-rules",
  "picomatch",
  "posthog-node",
]

const CODEX_COMPONENT_NOTICE_REQUIREMENTS = [
  {
    path: "packages/omo-codex/plugin/components/comment-checker",
    requiredTerms: ["pi-comment-checker", "@code-yeongyu/comment-checker"],
  },
  {
    path: "packages/omo-codex/plugin/components/lsp",
    requiredTerms: ["pi-lsp-client"],
  },
  {
    path: "packages/omo-codex/plugin/components/rules",
    requiredTerms: ["pi-rules", "picomatch"],
  },
  {
    path: "packages/omo-codex/plugin/components/start-work-continuation",
    requiredTerms: [],
  },
  {
    path: "packages/omo-codex/plugin/components/telemetry",
    requiredTerms: ["posthog-node", "@oh-my-opencode/telemetry-core"],
  },
  {
    path: "packages/omo-codex/plugin/components/ultrawork",
    requiredTerms: [],
  },
  {
    path: "packages/omo-codex/plugin/components/ulw-loop",
    requiredTerms: [],
  },
]

const scopes = {
  root: {
    noticePath: "THIRD-PARTY-NOTICES.md",
    requiredComponents() {
      const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
      return [...Object.keys(packageJson.dependencies ?? {}), ...ROOT_BUNDLED_COMPONENTS]
    },
  },
  codex: {
    noticePath: "packages/omo-codex/THIRD-PARTY-NOTICES.md",
    requiredComponents() {
      const componentsPath = join(repoRoot, "packages/omo-codex/plugin/components")
      const componentPackageNames = readdirSync(componentsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const packagePath = join(componentsPath, entry.name, "package.json")
          return JSON.parse(readFileSync(packagePath, "utf8")).name
        })

      return [...componentPackageNames, ...CODEX_AGGREGATE_COMPONENTS]
    },
    checkComponents: checkCodexComponentNotices,
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

function checkCodexComponentNotices() {
  const failures = []

  for (const requirement of CODEX_COMPONENT_NOTICE_REQUIREMENTS) {
    const noticePath = join(repoRoot, requirement.path, "NOTICE")
    const licensePath = join(repoRoot, requirement.path, "LICENSE")
    if (!existsSync(noticePath)) {
      failures.push(`${requirement.path}/NOTICE is missing`)
      continue
    }
    if (!existsSync(licensePath)) {
      failures.push(`${requirement.path}/LICENSE is missing`)
    }

    const noticeText = readFileSync(noticePath, "utf8")
    for (const term of requirement.requiredTerms) {
      if (!noticeText.includes(term)) {
        failures.push(`${requirement.path}/NOTICE is missing required term: ${term}`)
      }
    }
  }

  return failures
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
  const componentFailures = scope.checkComponents?.() ?? []

  if (missing.length > 0 || componentFailures.length > 0) {
    if (missing.length > 0) {
      console.error(`${scope.noticePath} is missing ${missing.length} required notice entries:`)
    }
    for (const component of missing) console.error(`- ${component}`)
    for (const failure of componentFailures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log(`${scope.noticePath}: ${requiredComponents.length} required notice entries present`)
}

const args = process.argv.slice(2)
if (args.includes("--codex")) {
  runScope("codex")
} else {
  runScope("root")
}
