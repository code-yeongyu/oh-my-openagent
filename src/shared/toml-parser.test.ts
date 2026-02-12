import { describe, expect, test } from "bun:test"
import { parseToml, parseTomlSafe, readTomlFile } from "./toml-parser"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

describe("parseToml", () => {
  test("parses simple key-value pairs", () => {
    // given
    const toml = `key = "value"`

    // when
    const result = parseToml<{ key: string }>(toml)

    // then
    expect(result.key).toBe("value")
  })

  test("parses integer values", () => {
    // given
    const toml = `count = 42`

    // when
    const result = parseToml<{ count: number }>(toml)

    // then
    expect(result.count).toBe(42)
  })

  test("parses float values", () => {
    // given
    const toml = `temperature = 0.1`

    // when
    const result = parseToml<{ temperature: number }>(toml)

    // then
    expect(result.temperature).toBe(0.1)
  })

  test("parses boolean values", () => {
    // given
    const toml = `
enabled = true
disabled = false`

    // when
    const result = parseToml<{ enabled: boolean; disabled: boolean }>(toml)

    // then
    expect(result.enabled).toBe(true)
    expect(result.disabled).toBe(false)
  })

  test("parses arrays", () => {
    // given
    const toml = `items = ["a", "b", "c"]`

    // when
    const result = parseToml<{ items: string[] }>(toml)

    // then
    expect(result.items).toEqual(["a", "b", "c"])
  })

  test("parses tables (sections)", () => {
    // given
    const toml = `
[agents.sisyphus]
model = "anthropic/claude-opus-4-6"
temperature = 0.1`

    // when
    const result = parseToml<{
      agents: { sisyphus: { model: string; temperature: number } }
    }>(toml)

    // then
    expect(result.agents.sisyphus.model).toBe("anthropic/claude-opus-4-6")
    expect(result.agents.sisyphus.temperature).toBe(0.1)
  })

  test("parses inline tables", () => {
    // given
    const toml = `point = { x = 1, y = 2 }`

    // when
    const result = parseToml<{ point: { x: number; y: number } }>(toml)

    // then
    expect(result.point.x).toBe(1)
    expect(result.point.y).toBe(2)
  })

  test("parses comments (ignored)", () => {
    // given
    const toml = `
# This is a comment
key = "value" # inline comment`

    // when
    const result = parseToml<{ key: string }>(toml)

    // then
    expect(result.key).toBe("value")
  })

  test("parses multiline strings", () => {
    // given
    const toml = `prompt = """
This is a
multiline string
"""`

    // when
    const result = parseToml<{ prompt: string }>(toml)

    // then
    expect(result.prompt).toContain("multiline string")
  })

  test("parses complex config structure", () => {
    // given
    const toml = `
# Oh My OpenCode config in TOML
disabled_hooks = ["comment-checker"]

[agents.sisyphus]
model = "anthropic/claude-opus-4-6"
temperature = 0.1

[agents.oracle]
model = "openai/gpt-5.2"

[claude_code]
enabled = true
`

    // when
    const result = parseToml<{
      agents: { sisyphus: { model: string; temperature: number }; oracle: { model: string } }
      disabled_hooks: string[]
      claude_code: { enabled: boolean }
    }>(toml)

    // then
    expect(result.agents.sisyphus.model).toBe("anthropic/claude-opus-4-6")
    expect(result.agents.sisyphus.temperature).toBe(0.1)
    expect(result.agents.oracle.model).toBe("openai/gpt-5.2")
    expect(result.disabled_hooks).toEqual(["comment-checker"])
    expect(result.claude_code.enabled).toBe(true)
  })

  test("throws on invalid TOML", () => {
    // given
    const invalid = `key = invalid value`

    // when
    // then
    expect(() => parseToml(invalid)).toThrow()
  })

  test("throws on invalid table syntax", () => {
    // given
    const invalid = `[table`

    // when
    // then
    expect(() => parseToml(invalid)).toThrow()
  })
})

describe("parseTomlSafe", () => {
  test("returns data on valid TOML", () => {
    // given
    const toml = `key = "value"`

    // when
    const result = parseTomlSafe<{ key: string }>(toml)

    // then
    expect(result.data).not.toBeNull()
    expect(result.data?.key).toBe("value")
    expect(result.errors).toHaveLength(0)
  })

  test("returns errors on invalid TOML", () => {
    // given
    const invalid = `key = invalid`

    // when
    const result = parseTomlSafe(invalid)

    // then
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe("readTomlFile", () => {
  const testDir = join(__dirname, ".test-toml")
  const testFile = join(testDir, "config.toml")

  test("reads and parses valid TOML file", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const content = `
# Comment
[agents]
model = "test"
`
    writeFileSync(testFile, content)

    // when
    const result = readTomlFile<{ agents: { model: string } }>(testFile)

    // then
    expect(result).not.toBeNull()
    expect(result?.agents.model).toBe("test")

    rmSync(testDir, { recursive: true, force: true })
  })

  test("returns null for non-existent file", () => {
    // given
    const nonExistent = join(testDir, "does-not-exist.toml")

    // when
    const result = readTomlFile(nonExistent)

    // then
    expect(result).toBeNull()
  })

  test("returns null for malformed TOML", () => {
    // given
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    writeFileSync(testFile, "key = invalid")

    // when
    const result = readTomlFile(testFile)

    // then
    expect(result).toBeNull()

    rmSync(testDir, { recursive: true, force: true })
  })
})
