/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import packageJson from "../../../../package.json" with { type: "json" }

describe("Codex package manifest", () => {
  test("includes the aggregate Codex plugin manifest in npm packages", () => {
    // given
    const files = packageJson.files

    // when
    const includesCodexManifestDirectory = files.includes("packages/omo-codex/plugin/.codex-plugin")

    // then
    expect(includesCodexManifestDirectory).toBe(true)
  })
})
