/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncLazycodexMarketplace } from "./sync-lazycodex-marketplace"

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writePluginFixture(sourceRoot: string): Promise<void> {
  await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
    name: "sisyphuslabs",
    plugins: [{ name: "omo", source: "./plugins/omo" }],
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), {
    name: "omo",
    version: "1.2.3",
  })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "README.md"), "omo\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored", "file.txt"), "ignored\n")
}

describe("sync-lazycodex-marketplace", () => {
  test("copies the Codex marketplace manifest and clean plugin bundle", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-lazycodex-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    const marketplace = JSON.parse(await readFile(join(lazycodexRoot, ".agents", "plugins", "marketplace.json"), "utf8"))
    expect(marketplace.name).toBe("sisyphuslabs")
    expect(marketplace.plugins[0].source).toBe("./plugins/omo")
    const manifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".codex-plugin", "plugin.json"), "utf8"))
    expect(manifest).toMatchObject({ name: "omo", version: "1.2.3" })
    await expect(stat(join(lazycodexRoot, "plugins", "omo", "node_modules"))).rejects.toThrow()
  })

  test("rejects a source tree without a Codex plugin manifest", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-lazycodex-"))
    await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
      name: "sisyphuslabs",
      plugins: [{ name: "omo", source: "./plugins/omo" }],
    })

    // when / then
    await expect(syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })).rejects.toThrow("missing Codex plugin manifest")
  })
})
