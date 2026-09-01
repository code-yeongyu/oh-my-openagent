/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readlink, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginBins, pruneMarketplaceCache, pruneMarketplacePluginCaches } from "./codex-cache"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"

describe("codex-cache security boundaries", () => {
  test("#given an array input #when using the cache record guard #then arrays remain rejected", () => {
    // given
    const value: unknown = []

    // when
    const result = isPlainRecord(value)

    // then
    expect(result).toBe(false)
  })

  test("#given a malformed path #when checking existence #then non-missing filesystem errors propagate", async () => {
    // given
    const malformedPath = "\0"

    // when
    const checked = fileExistsStrict(malformedPath)

    // then
    await expect(checked).rejects.toThrow()
  })

  test("#given a package bin name with path traversal #when linking cached plugin bins #then the installer rejects it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-bin-name-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "../escaped": "dist/cli.js" } }))
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const linked = linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    await expect(linked).rejects.toThrow("Invalid package bin command name")
    await expect(readlink(join(root, "escaped"))).rejects.toThrow()
  })

  test("#given a package bin target outside the package root #when linking cached plugin bins #then the installer rejects it", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-bin-target-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(root, "outside.js"), "#!/usr/bin/env node\n")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-escape": "../outside.js" } }))

    // when
    const linked = linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    await expect(linked).rejects.toThrow("Package bin target must stay inside package root")
    await expect(readlink(join(binDir, "omo-escape"))).rejects.toThrow()
  })

  test("#given marketplace cache disappears between checks #when pruning marketplace cache #then missing roots are ignored", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-prune-market-"))
    const cacheParent = join(root, "codex-home", "plugins", "cache")
    await mkdir(cacheParent, { recursive: true })
    await symlink(join(root, "missing-marketplace"), join(cacheParent, "debug"))

    // when
    const pruned = pruneMarketplaceCache({ codexHome: join(root, "codex-home"), marketplaceName: "debug", keepPluginNames: [] })

    // then
    await expect(pruned).resolves.toBeUndefined()
  })

  test("#given plugin cache disappears between checks #when pruning plugin caches #then missing roots are ignored", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-prune-plugin-"))
    const cacheParent = join(root, "codex-home", "plugins", "cache")
    await mkdir(cacheParent, { recursive: true })
    await symlink(join(root, "missing-marketplace"), join(cacheParent, "debug"))

    // when
    const pruned = pruneMarketplacePluginCaches({ codexHome: join(root, "codex-home"), marketplaceName: "debug", pluginNames: ["omo"] })

    // then
    await expect(pruned).resolves.toBeUndefined()
  })
})
