#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const WINDOWS_CMD_SHIM_COMMANDS = new Set(["npm", "npx"])

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
  "pi-lsp-client",
  "pi-rules",
  "pi-comment-checker",
  ...CODEGRAPH_COMPONENTS,
]

const CODEX_AGGREGATE_COMPONENTS = [
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

const ROOT_SHIP_REQUIRED_PATHS = [
  "THIRD-PARTY-NOTICES.md",
  "packages/omo-codex/THIRD-PARTY-NOTICES.md",
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

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"))
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

function runShipCheck() {
  const failures = []
  const rootPackageJson = readJson("package.json")
  const rootPackageFiles = rootPackageJson.files ?? []

  for (const path of ROOT_SHIP_REQUIRED_PATHS) {
    if (!rootPackageFiles.includes(path)) {
      failures.push(`package.json files[] is missing ${path}`)
    }
  }

  for (const requirement of CODEX_COMPONENT_NOTICE_REQUIREMENTS) {
    const packagePath = `${requirement.path}/package.json`
    const packageJson = readJson(packagePath)
    const packageFiles = packageJson.files ?? []
    for (const filename of ["LICENSE", "NOTICE"]) {
      if (existsSync(join(repoRoot, requirement.path, filename)) && !packageFiles.includes(filename)) {
        failures.push(`${packagePath} files[] is missing ${filename}`)
      }
    }
  }

  const packFiles = readRootDryRunPackFiles()
  const requiredPackPaths = [
    ...ROOT_SHIP_REQUIRED_PATHS,
    ...CODEX_COMPONENT_NOTICE_REQUIREMENTS.flatMap((requirement) =>
      ["LICENSE", "NOTICE"]
        .map((filename) => `${requirement.path}/${filename}`)
        .filter((path) => existsSync(join(repoRoot, path))),
    ),
  ]

  for (const path of unique(requiredPackPaths)) {
    if (!packFiles.has(path)) failures.push(`npm pack dry-run output is missing ${path}`)
  }

  if (failures.length > 0) {
    console.error(`ship verification failed with ${failures.length} issue(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log(`ship verification passed: ${requiredPackPaths.length} notice/license files present in root npm pack payload`)
}

function readRootDryRunPackFiles() {
  const npmPackArgs = ["pack", "--dry-run", "--json", "--ignore-scripts"]
  const invocation = resolveSpawnSyncInvocation("npm", npmPackArgs)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.stdout.write(result.stdout)
    throw new Error(`npm pack --dry-run --json --ignore-scripts failed with exit ${result.status}`)
  }
  const packJson = parseNpmPackJson(result.stdout)
  return new Set(packJson[0].files.map((file) => file.path))
}

export function resolveSpawnSyncInvocation(command, args, platform = process.platform) {
  const invocation = { command, args: Array.from(args) }
  if (platform !== "win32" || !WINDOWS_CMD_SHIM_COMMANDS.has(command.toLowerCase())) return invocation

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `${command}.cmd`, ...invocation.args],
  }
}

function parseNpmPackJson(output) {
  for (let index = output.indexOf("["); index !== -1; index = output.indexOf("[", index + 1)) {
    try {
      const parsed = JSON.parse(output.slice(index))
      if (Array.isArray(parsed) && parsed[0]?.files !== undefined) return parsed
    } catch (error) {
      if (error instanceof SyntaxError) continue
      throw error
    }
  }
  throw new Error("npm pack --dry-run --json did not produce a parseable file list")
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

function main(args = process.argv.slice(2)) {
  if (args.includes("--ship")) {
    runShipCheck()
  } else if (args.includes("--codex")) {
    runScope("codex")
  } else {
    runScope("root")
  }
}

if (isMainModule()) {
  main()
}
