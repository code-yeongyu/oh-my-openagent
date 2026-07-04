/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pruneMarketplacePluginVersions } from "./codex-cache"

describe("codex-cache prune", () => {
  test("#given multiple cached plugin versions #when pruning plugin versions #then only the installed version remains", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-version-prune-"))
    const codexHome = join(root, "codex-home")
    const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo")
    await mkdir(join(pluginRoot, "4.12.1"), { recursive: true })
    await mkdir(join(pluginRoot, "4.15.0"), { recursive: true })
    await mkdir(join(pluginRoot, "4.15.1"), { recursive: true })
    await writeFile(join(pluginRoot, "4.15.1", "package.json"), "{}")

    // when
    await pruneMarketplacePluginVersions({
      codexHome,
      marketplaceName: "sisyphuslabs",
      plugins: [{ name: "omo", version: "4.15.1" }],
    })

    // then
    expect(await readdir(pluginRoot)).toEqual(["4.15.1"])
    expect((await stat(join(pluginRoot, "4.15.1", "package.json"))).isFile()).toBe(true)
  })

  test("#given temp and backup cache siblings #when pruning plugin versions #then installer-owned working directories are removed", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-working-prune-"))
    const codexHome = join(root, "codex-home")
    const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo")
    await mkdir(join(pluginRoot, ".backup-4.15.1-100-200"), { recursive: true })
    await mkdir(join(pluginRoot, ".tmp-4.15.1-100-201"), { recursive: true })
    await mkdir(join(pluginRoot, "4.15.1"), { recursive: true })

    // when
    await pruneMarketplacePluginVersions({
      codexHome,
      marketplaceName: "sisyphuslabs",
      plugins: [{ name: "omo", version: "4.15.1" }],
    })

    // then
    expect(await readdir(pluginRoot)).toEqual(["4.15.1"])
  })
})
