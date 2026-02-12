import { describe, expect, test } from "bun:test"
import { detectConfigFile, type ConfigFormat } from "./config-detector"
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
