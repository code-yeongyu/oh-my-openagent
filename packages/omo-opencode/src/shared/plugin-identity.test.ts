import { describe, it, expect } from "bun:test"
import {
  ACCEPTED_PACKAGE_NAMES,
  CACHE_DIR_NAME,
  CONFIG_BASENAME,
  LEGACY_CONFIG_BASENAME,
  LEGACY_PLUGIN_NAME,
  LOG_FILENAME,
  PLUGIN_NAME,
  PUBLISHED_PACKAGE_NAME,
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

  describe("LEGACY_CONFIG_BASENAME", () => {
    it("equals oh-my-opencode", () => {
      // given

      // when

      // then
      expect(LEGACY_CONFIG_BASENAME).toBe("oh-my-opencode")
    })
  })

  describe("LEGACY_PLUGIN_NAME", () => {
    it("equals oh-my-opencode", () => {
      // given

      // when

      // then
      expect(LEGACY_PLUGIN_NAME).toBe("oh-my-opencode")
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
})
