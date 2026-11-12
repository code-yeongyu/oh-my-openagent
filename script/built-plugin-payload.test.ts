/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { stageBuiltPluginTree } from "./build-omo-binary"
import { assertBuiltPluginStaged, BUILT_PLUGIN_PAYLOAD } from "./built-plugin-payload"

// Release contract (#13192): stageSidecarPayload ends with this check, so a release binary staged from a tree where the
// generated plugin files were never built fails instead of embedding a plugin without them.
describe("built plugin payload check", () => {
  test.each(BUILT_PLUGIN_PAYLOAD)("#given a stage without %s #when checked #then it fails naming it", (missing) => {
    const staged = new Set(["package.json", ...BUILT_PLUGIN_PAYLOAD.filter((relPath) => relPath !== missing)])
    expect(() => assertBuiltPluginStaged(staged)).toThrow(missing)
  })

  test("#given a stage with both built files #when checked #then it passes", () => {
    expect(() => assertBuiltPluginStaged(new Set(["package.json", ...BUILT_PLUGIN_PAYLOAD]))).not.toThrow()
  })
})

describe("release staging of the plugin tree", () => {
  function pluginTree(files: readonly string[]): { readonly root: string; readonly plugin: string } {
    const root = mkdtempSync(join(tmpdir(), "omo-plugin-stage-test-"))
    const plugin = join(root, "plugin")
    for (const file of ["package.json", ...files]) {
      mkdirSync(join(plugin, file, ".."), { recursive: true })
      writeFileSync(join(plugin, file), "x")
    }
    return { root, plugin }
  }

  test("#given a plugin tree build-omo-native wrote without the generated files #when staged #then staging fails", () => {
    const { root, plugin } = pluginTree(["skills/fixture/SKILL.md"])
    try {
      expect(() => stageBuiltPluginTree(plugin, join(root, "stage"), new Set())).toThrow("plugin/extensions/omo.js")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a built plugin tree #when staged #then both generated files are staged", () => {
    const { root, plugin } = pluginTree(["extensions/omo.js", "scripts/install.mjs"])
    try {
      const staged = new Set<string>()
      stageBuiltPluginTree(plugin, join(root, "stage"), staged)
      for (const file of BUILT_PLUGIN_PAYLOAD) expect(staged.has(file)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
