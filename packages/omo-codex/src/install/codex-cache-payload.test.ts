/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { finalizeCachedPluginPayload } from "./codex-cache-payload"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const pluginUnder = (...parents: string[]): { readonly root: string; readonly pluginRoot: string } => {
  const root = mkdtempSync(join(tmpdir(), "codex-cache-payload-"))
  roots.push(root)
  const pluginRoot = join(root, ...parents, "plugin")
  mkdirSync(pluginRoot, { recursive: true })
  return { root, pluginRoot }
}

describe("finalizeCachedPluginPayload", () => {
  test("#given a CODEX_HOME whose own path contains /node_modules/.bin/ #when the payload is finalized #then a linked dependency is materialized, not pruned as an npm shim", async () => {
    // given
    const { root, pluginRoot } = pluginUnder("node_modules", ".bin", "codex-home")
    const target = join(root, "lsp-core")
    mkdirSync(target)
    writeFileSync(join(target, "package.json"), '{"name":"lsp-core"}')
    mkdirSync(join(pluginRoot, "node_modules"))
    symlinkSync(target, join(pluginRoot, "node_modules", "lsp-core"))

    // when
    await finalizeCachedPluginPayload(pluginRoot)

    // then
    const materialized = join(pluginRoot, "node_modules", "lsp-core")
    expect(lstatSync(materialized).isDirectory()).toBe(true)
    expect(readFileSync(join(materialized, "package.json"), "utf8")).toBe('{"name":"lsp-core"}')
  })

  test("#given a dependency link whose target is missing #when the payload is finalized #then it fails as an unsupported entry naming the link", async () => {
    // given
    const { root, pluginRoot } = pluginUnder()
    mkdirSync(join(pluginRoot, "node_modules"))
    symlinkSync(join(root, "missing"), join(pluginRoot, "node_modules", "lsp-daemon"))

    // when
    const finalized = finalizeCachedPluginPayload(pluginRoot)

    // then
    await expect(finalized).rejects.toThrow("Codex plugin contains unsupported entry types: node_modules/lsp-daemon")
  })

  test("#given a link inside the plugin's own node_modules/.bin #when the payload is finalized #then it is pruned", async () => {
    // given
    const { pluginRoot } = pluginUnder()
    mkdirSync(join(pluginRoot, "node_modules", ".bin"), { recursive: true })
    symlinkSync("../lsp-core/cli.js", join(pluginRoot, "node_modules", ".bin", "lsp"))

    // when
    await finalizeCachedPluginPayload(pluginRoot)

    // then
    expect(existsSync(join(pluginRoot, "node_modules", ".bin", "lsp"))).toBe(false)
  })
})
