import { describe, expect, test } from "bun:test"
import { detectConfigFile, parseJsonc, parseJsoncSafe, readJsoncFile } from "./jsonc-parser"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

describe("parseJsonc", () => {
  test("parses plain JSON", () => {
    //#given
    const json = `{"key": "value"}`

    //#when
    const result = parseJsonc<{ key: string }>(json)

    //#then
    expect(result.key).toBe("value")
  })

  test("parses JSONC with line comments", () => {
    //#given
    const jsonc = `{
      // This is a comment
      "key": "value"
    }`

    //#when
    const result = parseJsonc<{ key: string }>(jsonc)

    //#then
    expect(result.key).toBe("value")
  })

  test("parses JSONC with block comments", () => {
    //#given
    const jsonc = `{
      /* Block comment */
      "key": "value"
    }`

    //#when
    const result = parseJsonc<{ key: string }>(jsonc)

    //#then
    expect(result.key).toBe("value")
  })

  test("parses JSONC with multi-line block comments", () => {
    //#given
    const jsonc = `{
      /* Multi-line
         comment
         here */
      "key": "value"
    }`

    //#when
    const result = parseJsonc<{ key: string }>(jsonc)

    //#then
    expect(result.key).toBe("value")
  })

  test("parses JSONC with trailing commas", () => {
    //#given
    const jsonc = `{
      "key1": "value1",
      "key2": "value2",
    }`

    //#when
    const result = parseJsonc<{ key1: string; key2: string }>(jsonc)

    //#then
    expect(result.key1).toBe("value1")
    expect(result.key2).toBe("value2")
  })

  test("parses JSONC with trailing comma in array", () => {
    //#given
    const jsonc = `{
      "arr": [1, 2, 3,]
    }`

    //#when
    const result = parseJsonc<{ arr: number[] }>(jsonc)

    //#then
    expect(result.arr).toEqual([1, 2, 3])
  })

  test("preserves URLs with // in strings", () => {
    //#given
    const jsonc = `{
      "url": "https://example.com"
    }`

    //#when
    const result = parseJsonc<{ url: string }>(jsonc)

    //#then
    expect(result.url).toBe("https://example.com")
  })

  test("parses complex JSONC config", () => {
    //#given
    const jsonc = `{
      // This is an example config
      "agents": {
        "oracle": { "model": "openai/gpt-5.2" }, // GPT for strategic reasoning
      },
      /* Agent overrides */
      "disabled_agents": [],
    }`

    //#when
    const result = parseJsonc<{
      agents: { oracle: { model: string } }
      disabled_agents: string[]
    }>(jsonc)

    //#then
    expect(result.agents.oracle.model).toBe("openai/gpt-5.2")
    expect(result.disabled_agents).toEqual([])
  })

  test("throws on invalid JSON", () => {
    //#given
    const invalid = `{ "key": invalid }`

    //#when
    //#then
    expect(() => parseJsonc(invalid)).toThrow()
  })

  test("throws on unclosed string", () => {
    //#given
    const invalid = `{ "key": "unclosed }`

    //#when
    //#then
    expect(() => parseJsonc(invalid)).toThrow()
  })
})

describe("parseJsoncSafe", () => {
  test("returns data on valid JSONC", () => {
    //#given
    const jsonc = `{ "key": "value" }`

    //#when
    const result = parseJsoncSafe<{ key: string }>(jsonc)

    //#then
    expect(result.data).not.toBeNull()
    expect(result.data?.key).toBe("value")
    expect(result.errors).toHaveLength(0)
  })

  test("returns errors on invalid JSONC", () => {
    //#given
    const invalid = `{ "key": invalid }`

    //#when
    const result = parseJsoncSafe(invalid)

    //#then
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe("readJsoncFile", () => {
  const testDir = join(__dirname, ".test-jsonc")
  const testFile = join(testDir, "config.jsonc")

  test("reads and parses valid JSONC file", () => {
    //#given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const content = `{
      // Comment
      "test": "value"
    }`
    writeFileSync(testFile, content)

    //#when
    const result = readJsoncFile<{ test: string }>(testFile)

    //#then
    expect(result).not.toBeNull()
    expect(result?.test).toBe("value")

    rmSync(testDir, { recursive: true, force: true })
  })

  test("returns null for non-existent file", () => {
    //#given
    const nonExistent = join(testDir, "does-not-exist.jsonc")

    //#when
    const result = readJsoncFile(nonExistent)

    //#then
    expect(result).toBeNull()
  })

  test("returns null for malformed JSON", () => {
    //#given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    writeFileSync(testFile, "{ invalid }")

    //#when
    const result = readJsoncFile(testFile)

    //#then
    expect(result).toBeNull()

    rmSync(testDir, { recursive: true, force: true })
  })
})

describe("detectConfigFile", () => {
  const testDir = join(__dirname, ".test-detect")

  test("prefers .jsonc over .json", () => {
    //#given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.json`, "{}")
    writeFileSync(`${basePath}.jsonc`, "{}")

    //#when
    const result = detectConfigFile(basePath)

    //#then
    expect(result.format).toBe("jsonc")
    expect(result.path).toBe(`${basePath}.jsonc`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("detects .json when .jsonc doesn't exist", () => {
    //#given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.json`, "{}")

    //#when
    const result = detectConfigFile(basePath)

    //#then
    expect(result.format).toBe("json")
    expect(result.path).toBe(`${basePath}.json`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("returns none when neither exists", () => {
    //#given
    const basePath = join(testDir, "nonexistent")

    //#when
    const result = detectConfigFile(basePath)

    //#then
    expect(result.format).toBe("none")
  })
})
