import { describe, expect, test } from "bun:test"
import { detectConfigFile, parseConfigContent, type ConfigFormat } from "./config-detector"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

describe("detectConfigFile", () => {
  const testDir = join(__dirname, ".test-config-detect")

  test("prefers .jsonc over .json and .toml", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.json`, "{}")
    writeFileSync(`${basePath}.jsonc`, "{}")
    writeFileSync(`${basePath}.toml`, "key = \"value\"")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("jsonc")
    expect(result.path).toBe(`${basePath}.jsonc`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("prefers .json over .toml when .jsonc doesn't exist", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.json`, "{}")
    writeFileSync(`${basePath}.toml`, "key = \"value\"")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("json")
    expect(result.path).toBe(`${basePath}.json`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("detects .toml when only .toml exists", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.toml`, "key = \"value\"")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("toml")
    expect(result.path).toBe(`${basePath}.toml`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("detects .jsonc when only .jsonc exists", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.jsonc`, "{}")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("jsonc")
    expect(result.path).toBe(`${basePath}.jsonc`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("detects .json when only .json exists", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.json`, "{}")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("json")
    expect(result.path).toBe(`${basePath}.json`)

    rmSync(testDir, { recursive: true, force: true })
  })

  test("returns none when no config files exist", () => {
    // given
    const basePath = join(testDir, "nonexistent")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("none")
    expect(result.path).toBe(`${basePath}.json`)
  })

  test("returns correct path type for jsonc", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const basePath = join(testDir, "config")
    writeFileSync(`${basePath}.jsonc`, "{}")

    // when
    const result = detectConfigFile(basePath)

    // then
    expect(result.format).toBe("jsonc" as ConfigFormat)

    rmSync(testDir, { recursive: true, force: true })
  })
})

describe("parseConfigContent", () => {
  test("parses JSON content with json format", () => {
    // given
    const content = '{"key": "value", "num": 42}'

    // when
    const result = parseConfigContent(content, "json")

    // then
    expect(result).toEqual({ key: "value", num: 42 })
  })

  test("parses JSONC content with jsonc format", () => {
    // given
    const content = '{\n  // this is a comment\n  "key": "value"\n}'

    // when
    const result = parseConfigContent(content, "jsonc")

    // then
    expect(result).toEqual({ key: "value" })
  })

  test("parses TOML content with toml format", () => {
    // given
    const content = 'key = "value"\nnum = 42'

    // when
    const result = parseConfigContent(content, "toml")

    // then
    expect(result).toEqual({ key: "value", num: 42 })
  })

  test("parses nested TOML content", () => {
    // given
    const content = '[agents.sisyphus]\nmodel = "anthropic/claude-opus-4-6"\ntemperature = 0.1'

    // when
    const result = parseConfigContent<{ agents: { sisyphus: { model: string; temperature: number } } }>(content, "toml")

    // then
    expect(result.agents.sisyphus.model).toBe("anthropic/claude-opus-4-6")
    expect(result.agents.sisyphus.temperature).toBe(0.1)
  })

  test("falls back to JSONC parser for json format", () => {
    // given
    const content = '{"trailing": true,}'

    // when
    const result = parseConfigContent(content, "json")

    // then
    expect(result).toEqual({ trailing: true })
  })
})
