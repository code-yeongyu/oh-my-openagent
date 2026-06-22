import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { revertPinnedVersion, updatePinnedVersion } from "./pinned-version-updater"

describe("pinned-version-updater", () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "matrixx-updater-test-"))
    configPath = path.join(tmpDir, "opencode.json")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("updatePinnedVersion", () => {
    test("updates pinned version in config", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["opencode-matrixx@3.1.8"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "opencode-matrixx@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(true)
      const updated = fs.readFileSync(configPath, "utf-8")
      expect(updated).toContain("opencode-matrixx@3.4.0")
      expect(updated).not.toContain("opencode-matrixx@3.1.8")
    })

    test("returns false when entry not found", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["some-other-plugin"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "opencode-matrixx@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(false)
    })

    test("returns false when no plugin array exists", () => {
      //#given
      const config = JSON.stringify({ agent: {} })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "opencode-matrixx@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("revertPinnedVersion", () => {
    test("reverts from failed version back to original entry", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["opencode-matrixx@3.4.0"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "opencode-matrixx@3.1.8")

      //#then
      expect(result).toBe(true)
      const reverted = fs.readFileSync(configPath, "utf-8")
      expect(reverted).toContain("opencode-matrixx@3.1.8")
      expect(reverted).not.toContain("opencode-matrixx@3.4.0")
    })

    test("reverts to unpinned entry", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["opencode-matrixx@3.4.0"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "opencode-matrixx")

      //#then
      expect(result).toBe(true)
      const reverted = fs.readFileSync(configPath, "utf-8")
      expect(reverted).toContain('"opencode-matrixx"')
      expect(reverted).not.toContain("opencode-matrixx@3.4.0")
    })

    test("returns false when failed version not found", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["opencode-matrixx@3.1.8"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "opencode-matrixx@3.1.8")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("update then revert roundtrip", () => {
    test("config returns to original state after update + revert", () => {
      //#given
      const originalConfig = JSON.stringify({
        plugin: ["opencode-matrixx@3.1.8"],
      })
      fs.writeFileSync(configPath, originalConfig)

      //#when
      updatePinnedVersion(configPath, "opencode-matrixx@3.1.8", "3.4.0")
      revertPinnedVersion(configPath, "3.4.0", "opencode-matrixx@3.1.8")

      //#then
      const finalConfig = fs.readFileSync(configPath, "utf-8")
      expect(finalConfig).toContain("opencode-matrixx@3.1.8")
      expect(finalConfig).not.toContain("opencode-matrixx@3.4.0")
    })
  })
})
