import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectExternalNotificationPlugin, getNotificationConflictWarning } from "./external-plugin-detector"

describe("external-plugin-detector", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "matrixx-test-"))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("detectExternalNotificationPlugin", () => {
    test("should return detected=false when no plugins configured", () => {
      // given - empty directory
      // when
      const result = detectExternalNotificationPlugin(tempDir)
      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should return detected=false when only matrixx is configured", () => {
      // given - opencode.json with only matrixx
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["matrixx"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
      expect(result.allPlugins).toContain("matrixx")
    })

    test("should detect opencode-notifier plugin", () => {
      // given - opencode.json with opencode-notifier
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["matrixx", "opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should detect opencode-notifier with version suffix", () => {
      // given - opencode.json with versioned opencode-notifier
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["matrixx", "opencode-notifier@1.2.3"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should detect @mohak34/opencode-notifier", () => {
      // given - opencode.json with scoped package name
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["matrixx", "@mohak34/opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then - returns the matched known plugin pattern, not the full entry
      expect(result.detected).toBe(true)
      expect(result.pluginName).toContain("opencode-notifier")
    })

    test("should handle JSONC format with comments", () => {
      // given - opencode.jsonc with comments
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.jsonc"),
        `{
          // This is a comment
          "plugin": [
            "matrixx",
            "opencode-notifier" // Another comment
          ]
        }`
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })
  })

  describe("false positive prevention", () => {
    test("should NOT match my-opencode-notifier-fork (suffix variation)", () => {
      // given - plugin with similar name but different suffix
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["my-opencode-notifier-fork"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should NOT match some-other-plugin/opencode-notifier-like (path with similar name)", () => {
      // given - plugin path containing similar substring
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["some-other-plugin/opencode-notifier-like"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should NOT match opencode-notifier-extended (prefix match but different package)", () => {
      // given - plugin with prefix match but extended name
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["opencode-notifier-extended"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(false)
      expect(result.pluginName).toBeNull()
    })

    test("should match opencode-notifier exactly", () => {
      // given - exact match
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should match opencode-notifier@1.2.3 (version suffix)", () => {
      // given - version suffix
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["opencode-notifier@1.2.3"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should match @mohak34/opencode-notifier (scoped package)", () => {
      // given - scoped package
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["@mohak34/opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toContain("opencode-notifier")
    })

    test("should match npm:opencode-notifier (npm prefix)", () => {
      // given - npm prefix
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["npm:opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should match npm:opencode-notifier@2.0.0 (npm prefix with version)", () => {
      // given - npm prefix with version
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["npm:opencode-notifier@2.0.0"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })

    test("should match file:///path/to/opencode-notifier (file path)", () => {
      // given - file path
      const opencodeDir = path.join(tempDir, ".opencode")
      fs.mkdirSync(opencodeDir, { recursive: true })
      fs.writeFileSync(
        path.join(opencodeDir, "opencode.json"),
        JSON.stringify({ plugin: ["file:///home/user/plugins/opencode-notifier"] })
      )

      // when
      const result = detectExternalNotificationPlugin(tempDir)

      // then
      expect(result.detected).toBe(true)
      expect(result.pluginName).toBe("opencode-notifier")
    })
  })

  describe("getNotificationConflictWarning", () => {
    test("should generate warning message with plugin name", () => {
      // when
      const warning = getNotificationConflictWarning("opencode-notifier")

      // then
      expect(warning).toContain("opencode-notifier")
      expect(warning).toContain("session.idle")
      expect(warning).toContain("auto-disabled")
      expect(warning).toContain("force_enable")
    })
  })
})
