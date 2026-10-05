import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadPersonaAsset } from "./load"
import { PERSONA_ASSET_FILENAMES } from "./manifest"

describe("loadPersonaAsset", () => {
  it("#given a persona already read #when its file leaves the tree #then the process keeps serving the same content", () => {
    // given
    const assetsDir = mkdtempSync(join(tmpdir(), "persona-cache-"))
    try {
      const assetPath = join(assetsDir, PERSONA_ASSET_FILENAMES.kibitzer)
      writeFileSync(assetPath, "# kibitzer persona\n", "utf8")
      expect(loadPersonaAsset(assetsDir, "kibitzer")).toBe("# kibitzer persona\n")

      // when
      rmSync(assetPath)

      // then
      expect(loadPersonaAsset(assetsDir, "kibitzer")).toBe("# kibitzer persona\n")
    } finally {
      rmSync(assetsDir, { recursive: true, force: true })
    }
  })

  it("#given a read that failed #when the asset appears later #then the repaired tree is served without a restart", () => {
    // given
    const assetsDir = mkdtempSync(join(tmpdir(), "persona-repair-"))
    try {
      expect(() => loadPersonaAsset(assetsDir, "facts")).toThrow()

      // when
      writeFileSync(join(assetsDir, PERSONA_ASSET_FILENAMES.facts), "# facts persona\n", "utf8")

      // then
      expect(loadPersonaAsset(assetsDir, "facts")).toBe("# facts persona\n")
    } finally {
      rmSync(assetsDir, { recursive: true, force: true })
    }
  })
})
