import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { FALLBACK_SLUG, MAX_SLUG_LENGTH, sanitizeToSlug, shortHash } from "./resolve"

function expectedHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8)
}

describe("shortHash", () => {
  it("#given a string #when hashed #then it is the first 8 hex chars of its sha256", () => {
    // given / when / then
    expect(shortHash("backend-lead")).toBe(expectedHash("backend-lead"))
    expect(shortHash("backend-lead")).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe("sanitizeToSlug", () => {
  it("#given already-safe input #when sanitized #then it is unchanged", () => {
    // given / when / then
    expect(sanitizeToSlug("backend-lead")).toBe("backend-lead")
    expect(sanitizeToSlug("a1")).toBe("a1")
  })

  it("#given unicode input #when sanitized #then it folds to ascii or dashes", () => {
    // given / when / then
    expect(sanitizeToSlug("élan")).toBe("elan")
    expect(sanitizeToSlug("ＥＶＩＬ")).toBe("evil")
    expect(sanitizeToSlug("e\u202Evil")).toBe("e-vil")
    expect(sanitizeToSlug("漢字")).toBe(FALLBACK_SLUG)
  })

  it("#given separator-heavy input #when sanitized #then dashes collapse and trim", () => {
    // given / when / then
    expect(sanitizeToSlug("..")).toBe(FALLBACK_SLUG)
    expect(sanitizeToSlug(" -x- ")).toBe("x")
    expect(sanitizeToSlug("a\0b")).toBe("a-b")
    expect(sanitizeToSlug("a//b\\\\c")).toBe("a-b-c")
  })

  it("#given overlong input #when sanitized #then it caps without a trailing dash", () => {
    // given
    const input = `${"a".repeat(39)}-${"b".repeat(20)}`
    // when
    const slug = sanitizeToSlug(input)
    // then
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(slug.endsWith("-")).toBe(false)
    expect(slug).toBe("a".repeat(39))
  })
})
