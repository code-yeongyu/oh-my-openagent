import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const commandRoots = [".opencode/command", ".agents/command"] as const
const skillRoots = [".opencode/skills", ".agents/skills"] as const
const codexMaterializedRuntimePayloadPaths = [
  "dist/cli/index.js",
  "dist/cli-node/index.js",
  "packages/omo-codex/plugin/components/bootstrap/dist/cli.js",
  "packages/omo-codex/plugin/components/bootstrap/scripts/bootstrap.ps1",
  "packages/omo-codex/plugin/components/bootstrap/scripts/node-dispatch.ps1",
  "packages/omo-codex/plugin/components/codegraph/dist/cli.js",
  "packages/omo-codex/plugin/components/codegraph/dist/serve.js",
  "packages/omo-codex/plugin/components/comment-checker/dist/cli.js",
  "packages/omo-codex/plugin/components/git-bash/dist/cli.js",
  "packages/omo-codex/plugin/components/lazycodex-executor-verify/dist/cli.js",
  "packages/omo-codex/plugin/components/lsp/dist/cli.js",
  "packages/omo-codex/plugin/components/rules/dist/cli.js",
  "packages/omo-codex/plugin/components/start-work-continuation/dist/cli.js",
  "packages/omo-codex/plugin/components/teammode/dist/cli.js",
  "packages/omo-codex/plugin/components/telemetry/dist/cli.js",
  "packages/omo-codex/plugin/components/ultrawork/dist/cli.js",
  "packages/omo-codex/plugin/components/ulw-loop/dist/cli.js",
] as const
const webTerminalVisualQaRuntimePaths = [
  "script/qa/strip-ansi.mjs",
  "script/qa/web-terminal-redaction.d.mts",
  "script/qa/web-terminal-redaction.mjs",
  "script/qa/web-terminal-visual-qa.mjs",
  "script/qa/xterm-live-terminal.mjs",
] as const
const packageGuidanceDocPaths = [
  "docs/reference/github-attachment-upload.md",
  "docs/reference/web-terminal-visual-qa.md",
] as const
const packageLayoutTestTimeoutMs = 60_000
const packDryRunTimeoutMs = 15_000

setDefaultTimeout(packageLayoutTestTimeoutMs)

class PackDryRunError extends Error {
  constructor(readonly exitCode: number, readonly stderr: string) {
    super(`bun pm pack --dry-run --ignore-scripts failed with exit code ${exitCode}: ${stderr}`)
    this.name = "PackDryRunError"
  }
}

function toPackagePath(filePath: string): string {
  return relative(repositoryRoot, filePath).split(sep).join("/")
}

function collectPackagePathsRecursively(rootPath: string): string[] {
  const collectedPaths: string[] = []
  const directories = [rootPath]

  while (directories.length > 0) {
    const currentDirectory = directories.pop()
    if (!currentDirectory) {
      continue
    }

    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
        continue
      }

      if (entry.isFile()) {
        collectedPaths.push(toPackagePath(entryPath))
      }
    }
  }

  return collectedPaths
}

function collectCommandAssetPaths(rootRelativePath: string): string[] {
  const rootPath = join(repositoryRoot, rootRelativePath)
  if (!existsSync(rootPath)) {
    return []
  }

  return collectPackagePathsRecursively(rootPath)
    .filter((packagePath) => packagePath.endsWith(".md"))
    .sort()
}

function collectSkillAssetPaths(rootRelativePath: string): string[] {
  const rootPath = join(repositoryRoot, rootRelativePath)
  if (!existsSync(rootPath)) {
    return []
  }

  const expectedPaths: string[] = []

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const skillPath = join(rootPath, entry.name)
    const skillManifestPath = join(skillPath, "SKILL.md")
    if (entry.isDirectory() && existsSync(skillManifestPath)) {
      expectedPaths.push(...collectPackagePathsRecursively(skillPath))
    }
  }

  return expectedPaths.sort()
}

function collectExpectedAssetPaths(): string[] {
  return [
    ...commandRoots.flatMap(collectCommandAssetPaths),
    ...skillRoots.flatMap(collectSkillAssetPaths),
  ].sort()
}

function parsePackedPaths(output: string): Set<string> {
  const packedPaths = new Set<string>()
  const packedPathPattern = /^packed\s+\S+\s+(.+)$/

  for (const line of output.split("\n")) {
    const match = packedPathPattern.exec(line)
    const packedPath = match?.at(1)
    if (packedPath) {
      packedPaths.add(packedPath)
    }
  }

  return packedPaths
}

// Every test here packs the same unmutated tree, and `bun pm pack --dry-run` walks the whole
// multi-thousand-file payload on each call, so pack once and reuse the result.
let cachedPackDryRunPaths: Promise<Set<string>> | undefined

function packDryRunPaths(): Promise<Set<string>> {
  cachedPackDryRunPaths ??= runPackDryRun()
  return cachedPackDryRunPaths
}

async function runPackDryRun(): Promise<Set<string>> {
  const packProcess = Bun.spawn({
    cmd: ["bun", "pm", "pack", "--dry-run", "--ignore-scripts"],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(packProcess.stdout).text(),
    new Response(packProcess.stderr).text(),
    packProcess.exited,
  ])

  if (exitCode !== 0) {
    throw new PackDryRunError(exitCode, stderr)
  }

  return parsePackedPaths(stdout)
}

describe("published package layout", () => {
  test("#given vendored LSP MCP package #when inspecting tracked package files #then it is not a git submodule", () => {
    // given
    const gitmodulesPath = join(repositoryRoot, ".gitmodules")

    // when
    const trackedEntries = execFileSync("git", ["ls-files", "--stage", "packages/lsp-tools-mcp"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
    const trackedGitmodulesPath = execFileSync("git", ["ls-files", "--", ".gitmodules"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim()
    const gitmodules = trackedGitmodulesPath && existsSync(gitmodulesPath) ? Bun.file(gitmodulesPath).text() : Promise.resolve("")

    // then
    expect(trackedEntries).not.toContain("160000")
    expect(trackedEntries).toContain("packages/lsp-tools-mcp/package.json")
    return expect(gitmodules).resolves.not.toContain("packages/lsp-tools-mcp")
  })

  test("#given Codex LSP file dependency #when packing package #then lsp-tools-mcp package metadata ships", async () => {
    // given
    const expectedPackageRootManifest = "packages/lsp-tools-mcp/package.json"

    // when
    const packedPaths = await packDryRunPaths()

    // then
    expect(packedPaths.has(expectedPackageRootManifest)).toBe(true)
  }, packDryRunTimeoutMs)

  test("#given generated Codex installer bundle #when packing package #then generated output ships and stale forks do not", async () => {
    // given
    const expectedGeneratedInstaller = "packages/omo-codex/scripts/install-dist/install-local.mjs"
    const obsoleteForkPrefix = "packages/omo-codex/scripts/install/"

    // when
    const packedPaths = await packDryRunPaths()
    const packedObsoleteForks = [...packedPaths].filter((packagePath) => packagePath.startsWith(obsoleteForkPrefix))

    // then
    expect(packedPaths.has(expectedGeneratedInstaller)).toBe(true)
    expect(packedObsoleteForks).toEqual([])
  }, packDryRunTimeoutMs)

  test("#given Codex materialized runtime payloads #when packing package #then every current payload target ships", async () => {
    // given
    const expectedRuntimePaths = codexMaterializedRuntimePayloadPaths

    // when
    const packedPaths = await packDryRunPaths()
    const missingRuntimePaths = expectedRuntimePaths.filter((expectedPath) => !packedPaths.has(expectedPath))

    // then
    expect(missingRuntimePaths).toEqual([])
  }, packDryRunTimeoutMs)

  test("#given shipped QA skills reference web terminal helpers #when packing package #then helper runtime ships", async () => {
    // given
    const expectedRuntimePaths = webTerminalVisualQaRuntimePaths

    // when
    const packedPaths = await packDryRunPaths()
    const missingRuntimePaths = expectedRuntimePaths.filter((expectedPath) => !packedPaths.has(expectedPath))

    // then
    expect(missingRuntimePaths).toEqual([])
  }, packDryRunTimeoutMs)

  test("#given shipped QA skills reference guidance docs #when packing package #then referenced docs ship", async () => {
    // given
    const expectedDocPaths = packageGuidanceDocPaths

    // when
    const packedPaths = await packDryRunPaths()
    const missingDocPaths = expectedDocPaths.filter((expectedPath) => !packedPaths.has(expectedPath))

    // then
    expect(missingDocPaths).toEqual([])
  }, packDryRunTimeoutMs)

  test("#given Codex installer source tree #when checking obsolete forks #then hand-written install mjs files are absent", () => {
    // given
    const obsoleteForkRoot = join(repositoryRoot, "packages/omo-codex/scripts/install")

    // when
    const obsoleteForks = existsSync(obsoleteForkRoot)
      ? collectPackagePathsRecursively(obsoleteForkRoot).filter((packagePath) => packagePath.endsWith(".mjs"))
      : []

    // then
    expect(obsoleteForks).toEqual([])
  })

  test("#given dot-directory command and skill assets #when packing package #then slash-command discovery assets ship", async () => {
    // given
    const expectedAssetPaths = collectExpectedAssetPaths()
    expect(expectedAssetPaths).toContain(".opencode/command/security-research.md")
    expect(expectedAssetPaths).toContain(".agents/command/security-research.md")
    expect(expectedAssetPaths).toContain(".agents/skills/security-research/SKILL.md")
    expect(expectedAssetPaths).not.toContain(".opencode/command/security-review.md")
    expect(expectedAssetPaths).not.toContain(".agents/command/security-review.md")

    // when
    const packedPaths = await packDryRunPaths()

    // then
    const missingPaths = expectedAssetPaths.filter((expectedPath) => !packedPaths.has(expectedPath))
    expect(missingPaths).toEqual([])
  }, packDryRunTimeoutMs)
})
