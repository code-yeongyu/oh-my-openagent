import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { updatePinnedVersion, revertPinnedVersion } from "./pinned-version-updater"

describe("pinned-version-updater", () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-updater-test-"))
    configPath = path.join(tmpDir, "opencode.json")
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("updatePinnedVersion", () => {
    test("updates pinned version in config", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["oh-my-opencode@3.1.8"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "oh-my-opencode@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(true)
      const updated = fs.readFileSync(configPath, "utf-8")
      expect(updated).toContain("oh-my-opencode@3.4.0")
      expect(updated).not.toContain("oh-my-opencode@3.1.8")
    })

    test("returns false when entry not found", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["some-other-plugin"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "oh-my-opencode@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(false)
    })

    test("returns false when no plugin array exists", () => {
      //#given
      const config = JSON.stringify({ agent: {} })
      fs.writeFileSync(configPath, config)

      //#when
      const result = updatePinnedVersion(configPath, "oh-my-opencode@3.1.8", "3.4.0")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("revertPinnedVersion", () => {
    test("reverts from failed version back to original entry", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["oh-my-opencode@3.4.0"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "oh-my-opencode@3.1.8")

      //#then
      expect(result).toBe(true)
      const reverted = fs.readFileSync(configPath, "utf-8")
      expect(reverted).toContain("oh-my-opencode@3.1.8")
      expect(reverted).not.toContain("oh-my-opencode@3.4.0")
    })

    test("reverts to unpinned entry", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["oh-my-opencode@3.4.0"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "oh-my-opencode")

      //#then
      expect(result).toBe(true)
      const reverted = fs.readFileSync(configPath, "utf-8")
      expect(reverted).toContain('"oh-my-opencode"')
      expect(reverted).not.toContain("oh-my-opencode@3.4.0")
    })

    test("returns false when failed version not found", () => {
      //#given
      const config = JSON.stringify({
        plugin: ["oh-my-opencode@3.1.8"],
      })
      fs.writeFileSync(configPath, config)

      //#when
      const result = revertPinnedVersion(configPath, "3.4.0", "oh-my-opencode@3.1.8")

      //#then
      expect(result).toBe(false)
    })
  })

  describe("update then revert roundtrip", () => {
    test("config returns to original state after update + revert", () => {
      //#given
      const originalConfig = JSON.stringify({
        plugin: ["oh-my-opencode@3.1.8"],
      })
      fs.writeFileSync(configPath, originalConfig)

      //#when
      updatePinnedVersion(configPath, "oh-my-opencode@3.1.8", "3.4.0")
      revertPinnedVersion(configPath, "3.4.0", "oh-my-opencode@3.1.8")

      //#then
      const finalConfig = fs.readFileSync(configPath, "utf-8")
      expect(finalConfig).toContain("oh-my-opencode@3.1.8")
      expect(finalConfig).not.toContain("oh-my-opencode@3.4.0")
    })
  })
})
