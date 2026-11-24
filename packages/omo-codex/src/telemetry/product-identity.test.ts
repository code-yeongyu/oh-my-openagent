import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import packageJson from "../../package.json" with { type: "json" }
import { getProductVersion } from "./product-identity"

describe("getProductVersion", () => {
  it("returns the omo-codex package version from the single source of truth", () => {
    // when
    const version = getProductVersion()

    // then
    expect(version).toBe(packageJson.version)
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("#given an installed package whose plugin manifest was bumped without a rebuild #then the bumped version is reported", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-codex-product-version-"))
    try {
      mkdirSync(join(root, "plugin"), { recursive: true })
      writeFileSync(join(root, "plugin", "package.json"), JSON.stringify({ version: "9.0.1" }))
      const bundle = pathToFileURL(join(root, "scripts", "install-dist", "install-local.mjs")).href
      expect(getProductVersion(bundle)).toBe("9.0.1")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
