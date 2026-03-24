import { describe, expect, test } from "bun:test"
import { expandProfile, PROFILE_NAMES } from "./profiles"

describe("expandProfile", () => {
  describe("budget profile", () => {
    test("should set morpheus to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "google-vertex-anthropic/claude-sonnet-4-6@default"
      )
    })

    test("should set oracle to gemini 3.1 pro", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.agents?.oracle?.model).toBe("google-vertex/gemini-3.1-pro-preview")
    })

    test("should set source category to gemini 3.1 pro", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.categories?.["source"]?.model).toBe("google-vertex/gemini-3.1-pro-preview")
    })

    test("should set bullet-time category to gemini 2.5 flash", () => {
      //#given
      //#when
      const result = expandProfile("budget")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("google-vertex/gemini-2.5-flash")
    })
  })

  describe("balanced profile", () => {
    test("should set morpheus to opus", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "google-vertex-anthropic/claude-opus-4-6@default"
      )
    })

    test("should set oracle to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "google-vertex-anthropic/claude-sonnet-4-6@default"
      )
    })

    test("should set source category to sonnet", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.["source"]?.model).toBe(
        "google-vertex-anthropic/claude-sonnet-4-6@default"
      )
    })

    test("should set deep-jack category to gemini 3.1 pro", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.["deep-jack"]?.model).toBe("google-vertex/gemini-3.1-pro-preview")
    })

    test("should set bullet-time category to gemini 2.5 flash", () => {
      //#given
      //#when
      const result = expandProfile("balanced")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("google-vertex/gemini-2.5-flash")
    })
  })

  describe("performance profile", () => {
    test("should set morpheus to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "google-vertex-anthropic/claude-opus-4-6@default"
      )
    })

    test("should set oracle to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "google-vertex-anthropic/claude-opus-4-6@default"
      )
    })

    test("should set source category to opus", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.categories?.["source"]?.model).toBe(
        "google-vertex-anthropic/claude-opus-4-6@default"
      )
    })

    test("should set merovingian to gemini 3.1 pro", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.merovingian?.model).toBe("google-vertex/gemini-3.1-pro-preview")
    })

    test("should set trinity to gemini 2.5 flash", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.agents?.trinity?.model).toBe("google-vertex/gemini-2.5-flash")
    })

    test("should set bullet-time category to gemini 2.5 flash", () => {
      //#given
      //#when
      const result = expandProfile("performance")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("google-vertex/gemini-2.5-flash")
    })
  })

  describe("economy profile", () => {
    test("should set morpheus to haiku", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.morpheus?.model).toBe(
        "google-vertex-anthropic/claude-haiku-4-5@20251001"
      )
    })

    test("should set oracle to haiku", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.oracle?.model).toBe(
        "google-vertex-anthropic/claude-haiku-4-5@20251001"
      )
    })

    test("should set source category to haiku", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.categories?.["source"]?.model).toBe(
        "google-vertex-anthropic/claude-haiku-4-5@20251001"
      )
    })

    test("should set merovingian to gemini 3.1 pro", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.agents?.merovingian?.model).toBe("google-vertex/gemini-3.1-pro-preview")
    })

    test("should set bullet-time category to gemini 2.5 flash", () => {
      //#given
      //#when
      const result = expandProfile("economy")

      //#then
      expect(result.categories?.["bullet-time"]?.model).toBe("google-vertex/gemini-2.5-flash")
    })
  })

  describe("PROFILE_NAMES", () => {
    test("should export all four profile names", () => {
      //#given
      //#when
      //#then
      expect(PROFILE_NAMES).toContain("budget")
      expect(PROFILE_NAMES).toContain("economy")
      expect(PROFILE_NAMES).toContain("balanced")
      expect(PROFILE_NAMES).toContain("performance")
      expect(PROFILE_NAMES).toHaveLength(4)
    })
  })
})
