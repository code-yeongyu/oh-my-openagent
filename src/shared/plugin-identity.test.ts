import { describe, it, expect } from "bun:test"
import {
  PLUGIN_NAME,
  LEGACY_PLUGIN_NAME,
  CONFIG_BASENAME,
  LEGACY_CONFIG_BASENAME,
  LOG_FILENAME,
  CACHE_DIR_NAME,
  LEGACY_CACHE_DIR_NAME,
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

  describe("LEGACY_PLUGIN_NAME", () => {
    it("equals oh-my-opencode", () => {
      // given

      // when

      // then
      expect(LEGACY_PLUGIN_NAME).toBe("oh-my-opencode")
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

  describe("LOG_FILENAME", () => {
    it("equals oh-my-openagent.log", () => {
      // given

      // when

      // then
      expect(LOG_FILENAME).toBe("oh-my-openagent.log")
    })
  })

  describe("CACHE_DIR_NAME", () => {
    it("equals oh-my-openagent", () => {
      // given

      // when

      // then
      expect(CACHE_DIR_NAME).toBe("oh-my-openagent")
    })
  })

  describe("LEGACY_CACHE_DIR_NAME", () => {
    it("equals oh-my-opencode", () => {
      // given

      // when

      // then
      expect(LEGACY_CACHE_DIR_NAME).toBe("oh-my-opencode")
    })
  })
})
