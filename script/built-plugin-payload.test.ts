/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

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
