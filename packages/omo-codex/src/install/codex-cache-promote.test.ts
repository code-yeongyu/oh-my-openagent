/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { installCachedPlugin } from "./codex-cache"

describe("codex-cache promotion", () => {
  test("#given a helper still holding the active cache #when it exits during promotion #then the new version lands", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-promote-busy-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "plugin")
    const cacheRoot = join(codexHome, "plugins", "cache", "debug", "omo", "0.1.0")
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(join(cacheRoot, "node_modules"), { recursive: true })
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "@scope/omo", version: "0.1.0" }))
    await writeFile(join(cacheRoot, "package.json"), JSON.stringify({ name: "@scope/omo-old", version: "0.0.9" }))

    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      cwd: join(cacheRoot, "node_modules"),
      stdio: "ignore",
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    setTimeout(() => { try { holder.kill() } catch { /* already gone */ } }, 300)

    try {
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
      expect(installed.path).toBe(cacheRoot)
      expect(await readFile(join(cacheRoot, "package.json"), "utf8")).toBe(
        JSON.stringify({ name: "@scope/omo", version: "0.1.0" })
      )
    } finally {
      try { holder.kill() } catch { /* already gone */ }
    }
  }, { timeout: 20_000 })
})
