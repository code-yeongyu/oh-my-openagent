/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { OPENFERENCE_PROVIDER_COMPONENT_NAME, createOpenferenceProviderComponent } from "./index"
import { OPENFERENCE_ENV_VAR } from "./merge"

const tempDirs: string[] = []

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-openference-provider-"))
  tempDirs.push(dir)
  return dir
}

function ctxWithLogger(): { ctx: ComponentContext; warnings: string[] } {
  const warnings: string[] = []
  const logger: ComponentLogger = {
    debug: () => {},
    info: () => {},
    warn: (message) => {
      warnings.push(message)
    },
    error: () => {},
  }
  return { ctx: { logger, config: { getFlag: () => undefined } }, warnings }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("createOpenferenceProviderComponent", () => {
  const pi = new FakeExtensionAPI()

  test("does nothing without a credential", () => {
    // given an agent dir with no credential
    const dir = agentDir()

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: {} }).register(pi, ctx)

    // then models.json is not created
    expect(existsSync(join(dir, "models.json"))).toBe(false)
  })

  test("creates models.json with the bundled catalog when the env credential exists", () => {
    // given the env credential and no models.json
    const dir = agentDir()

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then models.json carries the openference provider with the full catalog
    const doc = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as Record<string, unknown>
    const providers = doc.providers as Record<string, Record<string, unknown>>
    const provider = providers.openference
    expect(provider.baseUrl).toBe("https://api.openference.com/v1")
    expect(provider.api).toBe("openai-completions")
    expect(provider.apiKey).toBe("$OPENFERENCE_API_KEY")
    expect(provider.headers).toEqual({ "User-Agent": "pi/openference" })
    const models = provider.models as Record<string, unknown>[]
    expect(models.length).toBe(15)
    expect(models.some((model) => model.id === "GLM-5.2")).toBe(true)
    expect(models.some((model) => model.id === "Kimi K2.7 Code")).toBe(true)
  })

  test("merges into an existing models.json without touching other providers", () => {
    // given a models.json with an unrelated provider
    const dir = agentDir()
    const existing = { providers: { ollama: { baseUrl: "http://localhost:11434/v1", api: "openai-completions" } } }
    writeFileSync(join(dir, "models.json"), JSON.stringify(existing, undefined, 2), "utf8")

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then the ollama block survives verbatim and openference is added
    const doc = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as Record<string, unknown>
    const providers = doc.providers as Record<string, Record<string, unknown>>
    expect(providers.ollama).toEqual({ baseUrl: "http://localhost:11434/v1", api: "openai-completions" })
    expect(providers.openference).toBeDefined()
  })

  test("keeps a user-pinned model entry verbatim", () => {
    // given a models.json where the user pinned GLM-5.2 under openference
    const dir = agentDir()
    const existing = {
      providers: { openference: { models: [{ id: "GLM-5.2", name: "Pinned", contextWindow: 1234, maxTokens: 56 }] } },
    }
    writeFileSync(join(dir, "models.json"), JSON.stringify(existing, undefined, 2), "utf8")

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then the pinned entry stays first and unchanged, and the rest of the catalog follows
    const doc = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as Record<string, unknown>
    const models = ((doc.providers as Record<string, Record<string, unknown>>).openference.models) as Record<
      string,
      unknown
    >[]
    expect(models[0]).toEqual({ id: "GLM-5.2", name: "Pinned", contextWindow: 1234, maxTokens: 56 })
    expect(models.length).toBe(15)
  })

  test("leaves malformed models.json untouched with a warning", () => {
    // given a models.json that is not valid JSON
    const dir = agentDir()
    const malformed = "{ not json"
    writeFileSync(join(dir, "models.json"), malformed, "utf8")

    // when the component registers
    const { ctx, warnings } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then the file content is unchanged and a warning was logged
    expect(readFileSync(join(dir, "models.json"), "utf8")).toBe(malformed)
    expect(warnings.length).toBe(1)
  })

  test("is idempotent: a second registration rewrites nothing", () => {
    // given a first registration that wrote models.json
    const dir = agentDir()
    const env = { [OPENFERENCE_ENV_VAR]: "sk-test" }
    const { ctx } = ctxWithLogger()
    const component = createOpenferenceProviderComponent({ agentDir: dir, env })
    component.register(pi, ctx)
    const firstWrite = readFileSync(join(dir, "models.json"), "utf8")

    // when the component registers a second time
    component.register(pi, ctx)

    // then the file is byte-identical
    expect(readFileSync(join(dir, "models.json"), "utf8")).toBe(firstWrite)
  })

  test("writes 2-space indented JSON with a trailing newline", () => {
    // given a fresh registration
    const dir = agentDir()

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then the file follows the repo's JSON serialization conventions
    const raw = readFileSync(join(dir, "models.json"), "utf8")
    expect(raw.endsWith("}\n")).toBe(true)
    expect(raw.split("\n")[1]).toBe('  "providers": {')
  })

  test("accepts an auth.json openference entry instead of the env var", () => {
    // given auth.json with an openference login entry and no env credential
    const dir = agentDir()
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ openference: { type: "api_key", apiKey: "sk-from-login" } }),
      "utf8",
    )

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: {} }).register(pi, ctx)

    // then models.json was written
    expect(existsSync(join(dir, "models.json"))).toBe(true)
  })

  test("component name drives the standard disable flag", () => {
    // given the component factory
    // when the component is created
    const component = createOpenferenceProviderComponent()

    // then its name follows the omo-senpi-<name>-disabled flag convention
    expect(component.name).toBe(OPENFERENCE_PROVIDER_COMPONENT_NAME)
    expect(component.name).toBe("openference-provider")
  })
})
