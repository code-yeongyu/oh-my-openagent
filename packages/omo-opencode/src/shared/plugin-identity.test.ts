import { describe, it, expect } from "bun:test"
import {
  PLUGIN_NAME,
  LEGACY_PLUGIN_NAME,
  PUBLISHED_PACKAGE_NAME,
  ACCEPTED_PACKAGE_NAMES,
  CACHE_DIR_NAME,
  CONFIG_BASENAME,
  LOG_FILENAME,
} from "./plugin-identity"

describe("plugin-identity constants", () => {
  describe("PLUGIN_NAME", () => {
    it("equals oh-my-openagent", () => {
      // given

      // when

      // then
      expect(PLUGIN_NAME).toBe("oh-my-openagent")
    })
  })

  describe("PUBLISHED_PACKAGE_NAME", () => {
    it("uses the canonical package name in this workspace", () => {
      // given

      // when

      // then
      expect(PUBLISHED_PACKAGE_NAME).toBe(PLUGIN_NAME)
    })

    it("is always one of the accepted published package names", () => {
      // given

      // when

      // then
      expect(ACCEPTED_PACKAGE_NAMES).toContain(PUBLISHED_PACKAGE_NAME)
    })
  })

  describe("ACCEPTED_PACKAGE_NAMES", () => {
    it("tries the canonical package before the legacy package", () => {
      // given

      // when

      // then
      expect(ACCEPTED_PACKAGE_NAMES).toEqual([PLUGIN_NAME, LEGACY_PLUGIN_NAME])
    })
  })

  describe("CONFIG_BASENAME", () => {
    it("equals oh-my-openagent", () => {
      // given

      // when

      // then
      expect(CONFIG_BASENAME).toBe("oh-my-openagent")
    })
  })

  describe("LOG_FILENAME", () => {
    it("equals oh-my-opencode.log", () => {
      // given

      // when

      // then
      expect(LOG_FILENAME).toBe("oh-my-opencode.log")
    })
  })

  describe("CACHE_DIR_NAME", () => {
    it("equals oh-my-opencode", () => {
      // given

      // when

      // then
      expect(CACHE_DIR_NAME).toBe("oh-my-opencode")
    })
  })

  describe("PUBLISHED_PACKAGE_NAME (issue #5081)", () => {
    it("resolves to whichever package name is actually installed", () => {
      // given: the running package — must be one of the two accepted names
      // when: PUBLISHED_PACKAGE_NAME is evaluated at module load

      // then: it must be either PLUGIN_NAME or LEGACY_PLUGIN_NAME
      expect([PLUGIN_NAME, LEGACY_PLUGIN_NAME]).toContain(PUBLISHED_PACKAGE_NAME)
    })

    it("is the name of the currently installed package", () => {
      // given: the running package (this test is bundled with one of them)
      // when: we try to require.resolve the published package
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require("node:module") as typeof import("node:module")
      const requireFromHere = createRequire(import.meta.url)
      let installedAs: string | null = null
      for (const candidate of [PLUGIN_NAME, LEGACY_PLUGIN_NAME]) {
        try {
          requireFromHere.resolve(`${candidate}/package.json`)
          installedAs = candidate
          break
        } catch {
          // not installed under this name
        }
      }

      // then: PUBLISHED_PACKAGE_NAME must match the actually-installed name
      expect(installedAs).not.toBeNull()
      expect(PUBLISHED_PACKAGE_NAME).toBe(installedAs)
    })
  })

  describe("ACCEPTED_PACKAGE_NAMES", () => {
    it("contains both PLUGIN_NAME and LEGACY_PLUGIN_NAME", () => {
      // given

      // when

      // then
      expect(ACCEPTED_PACKAGE_NAMES).toContain(PLUGIN_NAME)
      expect(ACCEPTED_PACKAGE_NAMES).toContain(LEGACY_PLUGIN_NAME)
    })

    it("lists PLUGIN_NAME before LEGACY_PLUGIN_NAME", () => {
      // given: the canonical (new) name should be tried first

      // then
      expect(ACCEPTED_PACKAGE_NAMES[0]).toBe(PLUGIN_NAME)
    })
  })
})
