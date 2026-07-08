/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

describe("install-codex cache pruning", () => {
  test("#given an old cached omo version #when installing current omo #then the installer prunes the stale version", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-cache-prune-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-cache-prune-bin-"))
    const oldVersionCacheRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.0.1")
    await mkdir(oldVersionCacheRoot, { recursive: true })
    await writeFile(join(oldVersionCacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.1" }))

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })

    // then
    expect((await stat(result.installed[0]?.path ?? "")).isDirectory()).toBe(true)
    await expect(stat(oldVersionCacheRoot)).rejects.toThrow()
  }, { timeout: 20_000 })
})
