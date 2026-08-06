/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse } from "node:path"
import { removeManagedPathBestEffort } from "./codex-cleanup"
import type { SkippedCleanupPath } from "./codex-cleanup"

describe("codex cleanup safety", () => {
  test("#given destructive cleanup targets #when managed removal runs #then rejects them and records skipped paths", async () => {
    // given
    const homeRoot = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-safety-home-"))
    const codexHome = join(homeRoot, ".codex")
    const workspaceRoot = join(homeRoot, "workspace")
    const managedCacheParent = join(codexHome, "plugins", "cache")
    await writeFixtureFile(join(codexHome, "config.toml"), "[features]\nplugins = true\n")
    await writeFixtureFile(join(workspaceRoot, "README.md"), "keep me\n")
    await mkdir(managedCacheParent, { recursive: true })

    const skipped: SkippedCleanupPath[] = []
    const targets = [homeRoot, codexHome, workspaceRoot, managedCacheParent]

    // when
    const removals: boolean[] = []
    for (const target of targets) {
      removals.push(
        await removeManagedPathBestEffort(target, {
          codexHome,
          onSkip: (skip) => skipped.push(skip),
        }),
      )
    }

    // then
    expect(removals).toEqual([false, false, false, false])
    expect(skipped.map((skip) => skip.path)).toEqual(targets)
    expect(skipped.every((skip) => skip.reason.includes("managed Codex cleanup scope"))).toBe(true)
    expect(await pathExists(join(codexHome, "config.toml"))).toBe(true)
    expect(await pathExists(join(workspaceRoot, "README.md"))).toBe(true)
    expect(await pathExists(managedCacheParent)).toBe(true)
  })

  test("#given traversal-shaped cleanup target #when managed removal runs #then canonical parent escapes are skipped", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cleanup-safety-codex-"))
    const managedCacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs")
    const traversalTarget = join(managedCacheRoot, "..", "..")
    await writeFixtureFile(join(managedCacheRoot, "omo", "0.1.0", "package.json"), "{}\n")
    const skipped: SkippedCleanupPath[] = []

    // when
    const removed = await removeManagedPathBestEffort(traversalTarget, {
      codexHome,
      onSkip: (skip) => skipped.push(skip),
    })

    // then
    expect(removed).toBe(false)
    expect(skipped).toEqual([
      {
        path: traversalTarget,
        reason: "outside managed Codex cleanup scope",
      },
    ])
    expect(await pathExists(join(managedCacheRoot, "omo", "0.1.0", "package.json"))).toBe(true)
  })

  test("#given filesystem root as Codex home #when managed removal runs #then refuses even shaped managed paths", async () => {
    // given
    const codexHome = parse(tmpdir()).root
    const shapedManagedTarget = join(codexHome, "plugins", "cache", "sisyphuslabs")
    const skipped: SkippedCleanupPath[] = []

    // when
    const removed = await removeManagedPathBestEffort(shapedManagedTarget, {
      codexHome,
      onSkip: (skip) => skipped.push(skip),
    })

    // then
    expect(removed).toBe(false)
    expect(skipped).toEqual([
      {
        path: shapedManagedTarget,
        reason: "Codex home resolves to a filesystem root",
      },
    ])
  })
})

async function writeFixtureFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}
