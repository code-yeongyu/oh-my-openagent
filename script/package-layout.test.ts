import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const commandRoots = [".opencode/command", ".agents/command"] as const
const skillRoots = [".opencode/skills", ".agents/skills"] as const
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

async function packDryRunPaths(): Promise<Set<string>> {
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
    const gitmodules = existsSync(gitmodulesPath) ? Bun.file(gitmodulesPath).text() : Promise.resolve("")

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
