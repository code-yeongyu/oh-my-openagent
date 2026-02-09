import { describe, expect, it } from "bun:test"
import { modifyProviderInJsonc } from "./jsonc-provider-editor"
import { parseJsonc } from "../../shared/jsonc-parser"

describe("modifyProviderInJsonc", () => {
  describe("Test 1: Basic JSONC with existing provider", () => {
    it("replaces provider value, preserves comments and other keys", () => {
      // given
      const content = `{
  // my config
  "provider": { "openai": {} },
  "plugin": ["foo"]
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"google"')
      expect(result).toContain('"plugin": ["foo"]')
      expect(result).toContain('// my config')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('plugin')
      expect(parsed).toHaveProperty('provider')
    })
  })

  describe("Test 2: Comment containing '}' inside provider block", () => {
    it("must NOT corrupt file", () => {
      // given
      const content = `{
  "provider": {
    // } this brace should be ignored
    "openai": {}
  },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
    })
  })

  describe("Test 3: Comment containing '\"provider\"' before real key", () => {
    it("must NOT match wrong location", () => {
      // given
      const content = `{
  // "provider": { "example": true }
  "provider": { "openai": {} },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
      expect(parsed.provider).toHaveProperty('google')
    })
  })

  describe("Test 4: Comment containing '{' inside provider", () => {
    it("must NOT mess up depth", () => {
      // given
      const content = `{
  "provider": {
    // { unmatched brace in comment
    "openai": {}
  },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
    })
  })

  describe("Test 5: No existing provider key", () => {
    it("inserts provider without corrupting", () => {
      // given
      const content = `{
  // config comment
  "plugin": ["foo"]
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"provider"')
      expect(result).toContain('"plugin"')
      expect(result).toContain('foo')
      expect(result).toContain('// config comment')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('provider')
      expect(parsed).toHaveProperty('plugin')
      expect(parsed.plugin).toEqual(['foo'])
    })
  })

  describe("Test 6: String value exactly 'provider' before real key", () => {
    it("must NOT match wrong location", () => {
      // given
      const content = `{
  "note": "provider",
  "provider": { "openai": {} },
  "other": 1
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(result).toContain('"other"')
      expect(result).toContain('"note": "provider"')

      // Post-write validation
      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('other')
      expect(parsed.other).toBe(1)
      expect(parsed.note).toBe('provider')
    })
  })

  describe("Test 7: Post-write validation", () => {
    it("result file must be valid JSONC for all cases", () => {
      // Test Case 1
      const content1 = `{
  "provider": { "openai": {} },
  "plugin": ["foo"]
}`
      const result1 = modifyProviderInJsonc(content1, { google: {} })
      expect(() => parseJsonc(result1)).not.toThrow()

      // Test Case 2
      const content2 = `{
  "provider": {
    // } comment
    "openai": {}
  }
}`
      const result2 = modifyProviderInJsonc(content2, { google: {} })
      expect(() => parseJsonc(result2)).not.toThrow()

      // Test Case 3
      const content3 = `{
  "plugin": ["foo"]
}`
      const result3 = modifyProviderInJsonc(content3, { google: {} })
      expect(() => parseJsonc(result3)).not.toThrow()
    })
  })

  describe("Test 8: Trailing commas preserved", () => {
    it("file is valid JSONC with trailing commas", () => {
      // given
      const content = `{
  "provider": { "openai": {}, },
  "plugin": ["foo",],
}`
      const newProviderValue = { google: { name: "Google" } }

      // when
      const result = modifyProviderInJsonc(content, newProviderValue)

      // then
      expect(() => parseJsonc(result)).not.toThrow()

      const parsed = parseJsonc<Record<string, unknown>>(result)
      expect(parsed).toHaveProperty('plugin')
      expect(parsed.plugin).toEqual(['foo'])
    })
  })
})
