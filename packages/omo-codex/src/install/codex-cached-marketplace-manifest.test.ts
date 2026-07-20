/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCachedMarketplaceManifest } from "./codex-cached-marketplace-manifest"

describe("writeCachedMarketplaceManifest", () => {
  test("#given installed plugin directory exists #when writing cached marketplace manifest #then local source points at that directory", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-cached-marketplace-manifest-"))
    const marketplaceRoot = join(root, "cache", "sisyphuslabs")
    const pluginRoot = join(marketplaceRoot, "omo", "1.0.0")
    await mkdir(pluginRoot, { recursive: true })

    // when
    await writeCachedMarketplaceManifest({
      marketplaceName: "sisyphuslabs",
      marketplaceRoot,
      plugins: [{ name: "omo", path: pluginRoot, version: "1.0.0" }],
    })

    // then
    const manifest = JSON.parse(await readFile(join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), "utf8")) as {
      readonly plugins: readonly [{ readonly source: { readonly path: string } }]
    }
    expect(manifest.plugins[0]?.source.path).toBe("./omo/1.0.0")
  })

  test("#given installed plugin directory is missing #when writing cached marketplace manifest #then existing manifest is preserved", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-cached-marketplace-manifest-missing-"))
    const marketplaceRoot = join(root, "cache", "sisyphuslabs")
    const manifestPath = join(marketplaceRoot, ".agents", "plugins", "marketplace.json")
    await mkdir(join(marketplaceRoot, ".agents", "plugins"), { recursive: true })
    await writeFile(manifestPath, "{\"name\":\"old\"}\n")

    // when / then
    await expect(
      writeCachedMarketplaceManifest({
        marketplaceName: "sisyphuslabs",
        marketplaceRoot,
        plugins: [{ name: "omo", path: join(marketplaceRoot, "omo", "2.0.0"), version: "2.0.0" }],
      }),
    ).rejects.toThrow(/does not exist/)
    expect(await readFile(manifestPath, "utf8")).toBe("{\"name\":\"old\"}\n")
  })
})
