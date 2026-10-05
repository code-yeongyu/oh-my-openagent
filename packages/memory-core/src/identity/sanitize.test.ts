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

  it("#given Latin input with diacritics or width variants #when sanitized #then it folds to ascii or dashes", () => {
    // given / when / then
    expect(sanitizeToSlug("élan")).toBe("elan")
    expect(sanitizeToSlug("ＥＶＩＬ")).toBe("evil")
    expect(sanitizeToSlug("e\u202Evil")).toBe("e-vil")
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

  it("#given the ASCII and Latin corpus #when sanitized #then every output matches the legacy slug byte for byte", () => {
    // given (characterization table: outputs of the pre-Unicode slugifier, pinned so
    // existing agents/people directories never move)
    const table: ReadonlyArray<readonly [string, string]> = [
      ["backend-lead", "backend-lead"],
      ["Backend Lead!", "backend-lead"],
      ["Yeongyu Park", "yeongyu-park"],
      ["  spaced  ", "spaced"],
      ["Hello!@#World", "hello-world"],
      ["C++ & Rust_2026", "c-rust-2026"],
      ["MiXeD_Case.Name", "mixed-case-name"],
      ["über-cool", "uber-cool"],
      ["../evil", "evil"],
      ["~/escape", "escape"],
      ["a".repeat(50), "a".repeat(MAX_SLUG_LENGTH)],
      ["", FALLBACK_SLUG],
      ["---", FALLBACK_SLUG],
      ["!!!", FALLBACK_SLUG],
    ]
    // when / then
    for (const [input, expected] of table) {
      expect(sanitizeToSlug(input)).toBe(expected)
    }
  })

  it("#given non-Latin letters #when sanitized #then the script is preserved instead of collapsing to the fallback", () => {
    // given / when / then
    expect(sanitizeToSlug("漢字")).toBe("漢字")
    expect(sanitizeToSlug("홍길동")).toBe("홍길동")
    expect(sanitizeToSlug("Иван")).toBe("иван")
    expect(sanitizeToSlug("Ærøskøbing")).toBe("ærøskøbing")
  })

  it("#given Korean display names #when sanitized #then distinct names yield distinct readable slugs", () => {
    // given / when
    const hong = sanitizeToSlug("홍길동")
    const kim = sanitizeToSlug("김철수")
    // then
    expect(hong).not.toBe(FALLBACK_SLUG)
    expect(kim).not.toBe(FALLBACK_SLUG)
    expect(hong).not.toBe(kim)
  })

  it("#given mixed Korean and Latin #when sanitized #then both scripts survive with dash separators", () => {
    // given / when / then
    expect(sanitizeToSlug("OmO 길동")).toBe("omo-길동")
    expect(sanitizeToSlug("팀장 Backend Lead")).toBe("팀장-backend-lead")
  })

  it("#given decomposed Hangul jamo #when sanitized #then the slug is the composed (NFC) syllables", () => {
    // given (NFD input as produced by some macOS filesystems)
    const decomposed = "홍길동".normalize("NFD")
    // when
    const slug = sanitizeToSlug(decomposed)
    // then
    expect(slug).toBe("홍길동")
    expect(slug).toBe(slug.normalize("NFC"))
  })

  it("#given overlong astral-plane letters #when capped #then the slug never splits a surrogate pair", () => {
    // given (U+2000B is a CJK Extension B letter: two UTF-16 code units each)
    const input = "\u{2000B}".repeat(MAX_SLUG_LENGTH + 5)
    // when
    const slug = sanitizeToSlug(input)
    // then
    expect(slug.isWellFormed()).toBe(true)
    expect(Array.from(slug).length).toBe(MAX_SLUG_LENGTH)
  })
})
