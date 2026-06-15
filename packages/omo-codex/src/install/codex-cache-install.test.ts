/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCachedPlugin } from "./codex-cache"

describe("codex-cache install", () => {
  test("#given source plugin has development-only directories #when caching plugin #then writes only the plugin payload under the versioned cache", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-layout-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    await mkdir(join(sourceRoot, ".git", "objects"), { recursive: true })
    await mkdir(join(sourceRoot, "node_modules", "left-pad"), { recursive: true })
    await mkdir(join(sourceRoot, "components", "rules", "node_modules", "debug"), { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(sourceRoot, ".git", "HEAD"), "ref: refs/heads/dev\n")
    await writeFile(join(sourceRoot, "node_modules", "left-pad", "package.json"), "{}")
    await writeFile(join(sourceRoot, "components", "rules", "node_modules", "debug", "package.json"), "{}")
    await writeFile(join(sourceRoot, "components", "rules", "payload.txt"), "payload\n")

    // when
    const installed = await installCachedPlugin({
      codexHome,
      marketplaceName: "debug",
      name: "omo",
      sourcePath: sourceRoot,
      version: "0.1.0",
      runCommand: async () => undefined,
    })

    // then
    expect(installed.path).toBe(join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0"))
    expect(await readFile(join(installed.path, "components", "rules", "payload.txt"), "utf8")).toBe("payload\n")
    await expect(stat(join(installed.path, ".git"))).rejects.toThrow()
    await expect(stat(join(installed.path, "node_modules"))).rejects.toThrow()
    await expect(stat(join(installed.path, "components", "rules", "node_modules"))).rejects.toThrow()
  })
})
