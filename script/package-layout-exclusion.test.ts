/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const fakeArtifactName = "__internal-fake-do-not-ship-test-artifact"
const packageAssetRoots = [".opencode/command", ".opencode/skills", ".agents/command", ".agents/skills"] as const
const fakeInternalSkillArtifactPaths = [
  `.opencode/skills/${fakeArtifactName}/SKILL.md`,
  `.agents/skills/${fakeArtifactName}/SKILL.md`,
] as const
const fakeInternalCommandArtifactPaths = [
  `.opencode/command/${fakeArtifactName}.md`,
  `.agents/command/${fakeArtifactName}.md`,
] as const
const shippedControlArtifactPaths = [
  ".opencode/skills/shipped-control/SKILL.md",
  ".agents/skills/shipped-control/SKILL.md",
  ".opencode/command/shipped-control.md",
  ".agents/command/shipped-control.md",
] as const
const packageLayoutTestTimeoutMs = 60_000

setDefaultTimeout(packageLayoutTestTimeoutMs)

// The fake artifacts live in a private fixture package, never in the checkout: other test files
// (script/package-layout.test.ts) walk and pack the checkout's asset roots concurrently. The
// fixture's asset roots carry copies of the repository's real .npmignore guards, which are the
// behavior under test.
let fixtureRoot = ""

class PackDryRunError extends Error {
  constructor(readonly exitCode: number, readonly stderr: string) {
    super(`bun pm pack --dry-run --ignore-scripts failed with exit code ${exitCode}: ${stderr}`)
    this.name = "PackDryRunError"
  }
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

// Both tests pack the SAME fixture state written once in beforeAll, so a single dry-run covers
// both. The cache is populated lazily inside a test body, after beforeAll has written the fixture.
let cachedPackDryRunPaths: Promise<Set<string>> | undefined

function packDryRunPaths(): Promise<Set<string>> {
  cachedPackDryRunPaths ??= runPackDryRun()
  return cachedPackDryRunPaths
}

async function runPackDryRun(): Promise<Set<string>> {
  const packProcess = Bun.spawn({
    cmd: ["bun", "pm", "pack", "--dry-run", "--ignore-scripts"],
    cwd: fixtureRoot,
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

function writeFixtureFile(packagePath: string, content: string): void {
  const filePath = join(fixtureRoot, packagePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function skillContent(name: string): string {
  return ["---", `name: ${name}`, "description: Fixture skill for package layout exclusion tests.", "---", ""].join("\n")
}

function writePackageFixture(): void {
  writeFixtureFile(
    "package.json",
    `${JSON.stringify({ name: "package-layout-exclusion-fixture", version: "0.0.0", files: packageAssetRoots }, null, 2)}\n`,
  )
  for (const assetRoot of packageAssetRoots) {
    const guardPath = `${assetRoot}/.npmignore`
    mkdirSync(join(fixtureRoot, assetRoot), { recursive: true })
    copyFileSync(join(repositoryRoot, guardPath), join(fixtureRoot, guardPath))
  }
  for (const packagePath of [...fakeInternalSkillArtifactPaths, ...shippedControlArtifactPaths]) {
    const content = packagePath.endsWith("/SKILL.md")
      ? skillContent(packagePath.split("/").at(-2) ?? fakeArtifactName)
      : "# Fixture command for package-layout-exclusion.test.ts\n"
    writeFixtureFile(packagePath, content)
  }
  for (const packagePath of fakeInternalCommandArtifactPaths) {
    writeFixtureFile(packagePath, "# Fake internal artifact for package-layout-exclusion.test.ts\n")
  }
}

describe("published package layout exclusions", () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "omo-package-layout-exclusion-"))
    writePackageFixture()
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("#given internal-only skill assets #when packing package #then forbidden skill assets do not ship", async () => {
    // given
    for (const packagePath of fakeInternalSkillArtifactPaths) {
      expect(readFileSync(join(fixtureRoot, packagePath), "utf8")).toStartWith("---\n")
    }

    // when
    const packedPaths = await packDryRunPaths()

    // then
    const packedInternalSkillPaths = fakeInternalSkillArtifactPaths.filter((packagePath) => packedPaths.has(packagePath))
    expect(packedInternalSkillPaths).toEqual([])
    const missingControlPaths = shippedControlArtifactPaths.filter((packagePath) => !packedPaths.has(packagePath))
    expect(missingControlPaths).toEqual([])
  }, { timeout: 20_000 })

  test("#given internal-only command assets #when packing package #then forbidden command assets do not ship", async () => {
    // when
    const packedPaths = await packDryRunPaths()

    // then
    const packedInternalCommandPaths = fakeInternalCommandArtifactPaths.filter((packagePath) => packedPaths.has(packagePath))
    expect(packedInternalCommandPaths).toEqual([])
    const missingControlPaths = shippedControlArtifactPaths.filter((packagePath) => !packedPaths.has(packagePath))
    expect(missingControlPaths).toEqual([])
  }, { timeout: 20_000 })
})
