import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { collectCustomProviderLimitIssues } from "./custom-provider-limits"

describe("collectCustomProviderLimitIssues (issue #4184)", () => {
  const originalXDGConfig = process.env["XDG_CONFIG_HOME"]
  const originalCwd = process.cwd()
  let tempDir: string
  let userConfigDir: string
  let projectDir: string

  beforeEach(() => {
    tempDir = join("/tmp", `doctor-provider-limits-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    userConfigDir = join(tempDir, "config", "opencode")
    projectDir = join(tempDir, "project")
    mkdirSync(userConfigDir, { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    process.env["XDG_CONFIG_HOME"] = join(tempDir, "config")
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalXDGConfig === undefined) {
      delete process.env["XDG_CONFIG_HOME"]
    } else {
      process.env["XDG_CONFIG_HOME"] = originalXDGConfig
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("returns no issues when no opencode.json exists", () => {
    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })

  test("flags an @ai-sdk/openai-compatible model without limit.context", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: { "glm-5.1": { name: "GLM-5.1" } },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()

    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("Custom provider model is missing limit.context")
    expect(issues[0]?.severity).toBe("warning")
    expect(issues[0]?.description).toContain("glm/glm-5.1")
    expect(issues[0]?.description).toContain("@ai-sdk/openai-compatible")
    expect(issues[0]?.fix).toContain("limit.context")
    expect(issues[0]?.fix).toContain("provider.glm.models.glm-5.1")
  })

  test("does not flag models that already specify limit.context", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: { "glm-5.1": { name: "GLM-5.1", limit: { context: 200000, output: 16384 } } },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })

  test("ignores providers that don't use @ai-sdk/openai-compatible", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          "my-builtin": {
            npm: "@some-other-sdk/provider",
            models: { "foo": {} },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })

  test("flags multiple models across multiple custom providers", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "glm-5.1": {},
              "glm-air": { limit: { context: 128000 } },
            },
          },
          kimi: {
            npm: "@ai-sdk/openai-compatible",
            models: { "kimi-k2": {} },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toHaveLength(2)
    const titles = issues.map((i) => i.description)
    expect(titles.some((t) => t.includes("glm/glm-5.1"))).toBe(true)
    expect(titles.some((t) => t.includes("kimi/kimi-k2"))).toBe(true)
    expect(titles.some((t) => t.includes("glm/glm-air"))).toBe(false)
  })

  test("also scans project .opencode/opencode.json", () => {
    writeFileSync(
      join(projectDir, ".opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          "project-llm": {
            npm: "@ai-sdk/openai-compatible",
            models: { "model-a": {} },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.description).toContain("project-llm/model-a")
  })

  test("treats limit.context: 0 as missing (matches OpenCode overflow detector)", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: { "glm-5.1": { limit: { context: 0, output: 0 } } },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toHaveLength(1)
  })

  // hardening from cubic-dev-ai review on #4276 ↓

  test("does not crash when a provider entry is null (malformed config)", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          "broken": null,
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: { "glm-5.1": {} },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.description).toContain("glm/glm-5.1")
  })

  test("does not crash when a model entry is null or a primitive", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "glm-broken": null,
              "glm-also-broken": "not-an-object",
              "glm-good": { limit: { context: 128000 } },
            },
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toHaveLength(2)
    const descriptions = issues.map((i) => i.description).join("\n")
    expect(descriptions).toContain("glm/glm-broken")
    expect(descriptions).toContain("glm/glm-also-broken")
    expect(descriptions).not.toContain("glm/glm-good")
  })

  test("does not crash when the top-level provider field is malformed", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({ provider: "not-an-object" })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })

  test("does not crash when provider.models is malformed", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: {
            npm: "@ai-sdk/openai-compatible",
            models: "garbage",
          },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })

  test("does not crash when provider.npm is null", () => {
    writeFileSync(
      join(userConfigDir, "opencode.json"),
      JSON.stringify({
        provider: {
          glm: { npm: null, models: { "glm-5.1": {} } },
        },
      })
    )

    const issues = collectCustomProviderLimitIssues()
    expect(issues).toEqual([])
  })
})
