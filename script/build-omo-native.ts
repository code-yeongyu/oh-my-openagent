#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageDir = join(repoRoot, "packages", "omo-native")
const sourcePluginDir = join(repoRoot, "packages", "omo-senpi", "plugin")
const defaultOutputDir = join(packageDir, "plugin")

// Mirrors REQUIRED_PLUGIN_ARTIFACTS in packages/omo-senpi/src/install/install-senpi.ts.
const REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("skills", "ast-grep", "SKILL.md"),
  join("skills", "coding-agent-sessions", "SKILL.md"),
  join("skills", "debugging", "SKILL.md"),
  join("skills", "frontend", "SKILL.md"),
  join("skills", "git-master", "SKILL.md"),
  join("skills", "init-deep", "SKILL.md"),
  join("skills", "lsp-setup", "SKILL.md"),
  join("skills", "programming", "SKILL.md"),
  join("skills", "refactor", "SKILL.md"),
  join("skills", "remove-ai-slops", "SKILL.md"),
  join("skills", "review-work", "SKILL.md"),
  join("skills", "start-work", "SKILL.md"),
  join("skills", "ultimate-browsing", "SKILL.md"),
  join("skills", "ultrawork", "SKILL.md"),
  join("skills", "ulw-loop", "SKILL.md"),
  join("skills", "ulw-plan", "SKILL.md"),
  join("skills", "ulw-research", "SKILL.md"),
  join("skills", "visual-qa", "SKILL.md"),
  join("runtime", "ast-grep-mcp", "cli.js"),
  join("runtime", "agent-toolkit", "cli.js"),
  join("runtime", "agent-toolkit", "ulw-loop", "cli.js"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit.cmd"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "lsp-daemon", "dist", "index.js"),
  join("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join("runtime", "lsp-daemon", "dist", "package.json"),
  join("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join("scripts", "install.mjs"),
] as const

// Mirrors the files allowlist in packages/omo-senpi/plugin/package.json.
const PAYLOAD_DIRECTORIES = ["extensions", "skills", "runtime"] as const
const PAYLOAD_FILES = ["package.json", "README.md", "NOTICE", "LICENSE"] as const
const PAYLOAD_SCRIPT = join("scripts", "install.mjs")

interface BuildOptions {
  readonly outputDir: string
  readonly checkOnly: boolean
}

function parseArgs(argv: readonly string[]): BuildOptions {
  let outputDir = defaultOutputDir
  let checkOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--check-only") {
      checkOnly = true
    } else if (argument === "--output") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--output requires a directory path")
      outputDir = resolve(value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return { outputDir, checkOnly }
}

function runSenpiPluginBuild(): void {
  const result = spawnSync("bun", ["run", "build:senpi-plugin"], {
    cwd: repoRoot,
    stdio: "inherit",
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build:senpi-plugin failed with exit code ${result.status ?? 1}`)
  }
}

function copyTree(sourceDir: string, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue
    const sourcePath = join(sourceDir, entry.name)
    const outputPath = join(outputDir, entry.name)
    if (entry.isDirectory()) {
      copyTree(sourcePath, outputPath)
    } else if (entry.isFile()) {
      if (entry.name.includes(".test.")) continue
      copyFileSync(sourcePath, outputPath)
      chmodSync(outputPath, statSync(sourcePath).mode & 0o777)
    }
  }
}

function copyFileIfPresent(sourcePath: string, outputPath: string): void {
  if (!existsSync(sourcePath)) return
  mkdirSync(dirname(outputPath), { recursive: true })
  copyFileSync(sourcePath, outputPath)
  chmodSync(outputPath, statSync(sourcePath).mode & 0o777)
}

function copyPluginPayload(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true })
  for (const name of PAYLOAD_DIRECTORIES) {
    const sourcePath = join(sourcePluginDir, name)
    if (existsSync(sourcePath)) copyTree(sourcePath, join(outputDir, name))
  }
  for (const name of PAYLOAD_FILES) {
    copyFileIfPresent(join(sourcePluginDir, name), join(outputDir, name))
  }
  copyFileIfPresent(join(sourcePluginDir, PAYLOAD_SCRIPT), join(outputDir, PAYLOAD_SCRIPT))
}

function findMissingArtifact(outputDir: string): string | undefined {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!existsSync(join(outputDir, artifact))) return artifact
  }
  return undefined
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv)
  if (!options.checkOnly) {
    rmSync(options.outputDir, { recursive: true, force: true })
    runSenpiPluginBuild()
    copyPluginPayload(options.outputDir)
  }
  const missing = findMissingArtifact(options.outputDir)
  if (missing !== undefined) {
    console.error(
      `omo-native payload completeness check failed: missing required artifact: ${missing}`,
    )
    return 1
  }
  if (!options.checkOnly) {
    writeFileSync(join(packageDir, ".gitignore"), "/plugin/\n", "utf8")
  }
  console.log(
    `omo-native payload complete at ${options.outputDir} (${REQUIRED_PLUGIN_ARTIFACTS.length} required artifacts present)`,
  )
  return 0
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
