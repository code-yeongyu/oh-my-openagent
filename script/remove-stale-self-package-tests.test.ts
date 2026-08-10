import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { removeStaleSelfPackageTests } from "./remove-stale-self-package-tests"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("removeStaleSelfPackageTests", () => {
  test("#given package-local self-package tests #when cleanup runs #then only stale self copies are removed", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-stale-self-package-"))
    tempDirs.push(root)
    const staleOpenCode = join(root, "packages", "adapter-a", "node_modules", "oh-my-opencode")
    const staleOpenAgent = join(root, "packages", "adapter-b", "node_modules", "oh-my-openagent")
    const unrelated = join(root, "packages", "adapter-b", "node_modules", "unrelated-package")
    await Promise.all([
      writeFixture(staleOpenCode),
      writeFixture(staleOpenAgent),
      writeFixture(unrelated),
    ])

    // when
    const removed = await removeStaleSelfPackageTests(root)

    // then
    expect(removed).toEqual([
      "packages/adapter-a/node_modules/oh-my-opencode",
      "packages/adapter-b/node_modules/oh-my-openagent",
    ])
    await expectPathMissing(staleOpenCode)
    await expectPathMissing(staleOpenAgent)
    expect((await stat(unrelated)).isDirectory()).toBe(true)
  })

  test("#given root and Senpi CI jobs #when steps are ordered #then stale self tests are removed before each suite", async () => {
    // given
    const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

    // when
    const installIndex = workflow.indexOf("      - name: Install dependencies")
    const cleanupIndex = workflow.indexOf("      - name: Remove stale self-package test copies")
    const testIndex = workflow.indexOf("      - name: Run tests")
    const senpiJobIndex = workflow.indexOf("  senpi-compatibility:")
    const senpiInstallIndex = workflow.indexOf("      - name: Install dependencies", senpiJobIndex)
    const senpiCleanupIndex = workflow.indexOf("      - name: Remove stale self-package test copies", senpiJobIndex)
    const senpiTestIndex = workflow.indexOf("      - name: Run Senpi compatibility tests", senpiJobIndex)
    const cleanupCount = workflow.match(/      - name: Remove stale self-package test copies/g)?.length ?? 0

    // then
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(cleanupIndex).toBeGreaterThan(installIndex)
    expect(testIndex).toBeGreaterThan(cleanupIndex)
    expect(senpiInstallIndex).toBeGreaterThan(senpiJobIndex)
    expect(senpiCleanupIndex).toBeGreaterThan(senpiInstallIndex)
    expect(senpiTestIndex).toBeGreaterThan(senpiCleanupIndex)
    expect(cleanupCount).toBe(2)
    expect(workflow.match(/run: bun run script\/remove-stale-self-package-tests\.ts/g)).toHaveLength(2)
  })
})

async function writeFixture(path: string): Promise<void> {
  await mkdir(join(path, "src"), { recursive: true })
  await writeFile(join(path, "src", "stale.test.ts"), "test('stale', () => {})\n")
}

async function expectPathMissing(path: string): Promise<void> {
  try {
    await stat(path)
    throw new Error(`expected path to be missing: ${path}`)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}
