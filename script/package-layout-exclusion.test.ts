/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const packageJsonPath = join(repositoryRoot, "package.json")
const fakeArtifactName = "__internal-fake-do-not-ship-test-artifact"
const packageAssetRoots = [".opencode/command", ".opencode/skills", ".agents/command", ".agents/skills"] as const
const fakeInternalSkillArtifactRootPaths = [
  `.opencode/skills/${fakeArtifactName}`,
  `.agents/skills/${fakeArtifactName}`,
] as const
const fakeInternalSkillArtifactPaths = [
  `${fakeInternalSkillArtifactRootPaths[0]}/SKILL.md`,
  `${fakeInternalSkillArtifactRootPaths[1]}/SKILL.md`,
] as const
const fakeInternalCommandArtifactPaths = [
  `.opencode/command/${fakeArtifactName}.md`,
  `.agents/command/${fakeArtifactName}.md`,
] as const
const fakeInternalArtifactCleanupPaths = [
  ...fakeInternalSkillArtifactRootPaths,
  ...fakeInternalCommandArtifactPaths,
] as const
const packageLayoutTestTimeoutMs = 60_000

setDefaultTimeout(packageLayoutTestTimeoutMs)

let originalPackageJsonText: string | null = null
let packageJsonWasTemporarilyModified = false

class PackDryRunError extends Error {
  constructor(readonly exitCode: number, readonly stderr: string) {
    super(`bun pm pack --dry-run --ignore-scripts failed with exit code ${exitCode}: ${stderr}`)
    this.name = "PackDryRunError"
  }
}

class PackageFilesAnchorError extends Error {
  constructor() {
    super("package.json files list no longer contains the postinstall.mjs anchor")
    this.name = "PackageFilesAnchorError"
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

function withPackageAssetRoots(packageJsonText: string): string {
  const missingAssetRoots = packageAssetRoots.filter((rootPath) => !packageJsonText.includes(`"${rootPath}"`))
  if (missingAssetRoots.length === 0) {
    return packageJsonText
  }

  const filesAnchor = '    "postinstall.mjs",\n'
  if (!packageJsonText.includes(filesAnchor)) {
    throw new PackageFilesAnchorError()
  }

  const insertedAssetRoots = missingAssetRoots.map((rootPath) => `    "${rootPath}",`).join("\n")
  return packageJsonText.replace(filesAnchor, `${filesAnchor}${insertedAssetRoots}\n`)
}

function preparePackageJsonForDotAssetPacking(): void {
  const packageJsonText = readFileSync(packageJsonPath, "utf8")
  originalPackageJsonText = packageJsonText
  const packageJsonTextWithAssetRoots = withPackageAssetRoots(packageJsonText)
  packageJsonWasTemporarilyModified = packageJsonTextWithAssetRoots !== packageJsonText

  if (packageJsonWasTemporarilyModified) {
    writeFileSync(packageJsonPath, packageJsonTextWithAssetRoots)
  }
}

function restorePackageJson(): void {
  if (packageJsonWasTemporarilyModified && originalPackageJsonText !== null) {
    writeFileSync(packageJsonPath, originalPackageJsonText)
  }
}

function removeFakeInternalArtifacts(): void {
  for (const packagePath of fakeInternalArtifactCleanupPaths) {
    rmSync(join(repositoryRoot, packagePath), { recursive: true, force: true })
  }
}

function writeFakeInternalArtifacts(packagePaths: readonly string[]): void {
  for (const packagePath of packagePaths) {
    const artifactPath = join(repositoryRoot, packagePath)
    mkdirSync(dirname(artifactPath), { recursive: true })
    const content = packagePath.endsWith("/SKILL.md")
      ? [
          "---",
          `name: ${fakeArtifactName}`,
          "description: Internal fake skill artifact for package layout exclusion tests.",
          "---",
          "",
          "# Fake internal artifact for package-layout-exclusion.test.ts",
          "",
        ].join("\n")
      : "# Fake internal artifact for package-layout-exclusion.test.ts\n"
    writeFileSync(artifactPath, content)
  }
}

function collectExistingFakeInternalSkillArtifactPaths(): string[] {
  return fakeInternalSkillArtifactRootPaths
    .filter((packagePath) => existsSync(join(repositoryRoot, packagePath)))
    .flatMap((packagePath) => collectPackagePathsRecursively(join(repositoryRoot, packagePath)))
    .sort()
}

describe("published package layout exclusions", () => {
  beforeAll(() => {
    removeFakeInternalArtifacts()

    try {
      preparePackageJsonForDotAssetPacking()
      writeFakeInternalArtifacts([...fakeInternalSkillArtifactPaths, ...fakeInternalCommandArtifactPaths])
    } catch (error) {
      removeFakeInternalArtifacts()
      restorePackageJson()
      throw error
    }
  })

  afterAll(() => {
    removeFakeInternalArtifacts()
    restorePackageJson()
  })

  test("#given internal-only skill assets #when packing package #then forbidden skill assets do not ship", async () => {
    // given
    expect(collectExistingFakeInternalSkillArtifactPaths()).toEqual(fakeInternalSkillArtifactPaths.toSorted())
    for (const packagePath of fakeInternalSkillArtifactPaths) {
      expect(readFileSync(join(repositoryRoot, packagePath), "utf8")).toStartWith("---\n")
    }

    // when
    const packedPaths = await packDryRunPaths()

    // then
    const packedInternalSkillPaths = fakeInternalSkillArtifactPaths.filter((packagePath) => packedPaths.has(packagePath))
    expect(packedInternalSkillPaths).toEqual([])
  }, { timeout: 20_000 })

  test("#given internal-only command assets #when packing package #then forbidden command assets do not ship", async () => {
    // given
    for (const packagePath of fakeInternalCommandArtifactPaths) {
      expect(existsSync(join(repositoryRoot, packagePath))).toBe(true)
    }

    // when
    const packedPaths = await packDryRunPaths()

    // then
    const packedInternalCommandPaths = fakeInternalCommandArtifactPaths.filter((packagePath) => packedPaths.has(packagePath))
    expect(packedInternalCommandPaths).toEqual([])
  }, { timeout: 20_000 })
})
