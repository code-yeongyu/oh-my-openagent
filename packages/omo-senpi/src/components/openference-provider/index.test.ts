/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AuthContext, AuthResult, Model, Provider } from "@earendil-works/pi-ai"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import extension from "../../extension"
import catalogJson from "./openference-senpi-models.json"
import {
  createOpenferenceProviderComponent,
  OPENFERENCE_BASE_URL,
  OPENFERENCE_ENV_VAR,
  OPENFERENCE_PROVIDER_COMPONENT_NAME,
  OPENFERENCE_USER_AGENT,
} from "./index"

// The committed catalog is the source of truth for model count; the shape of
// each entry is pinned by the generator suite.
const CATALOG_COUNT = (catalogJson as unknown[]).length

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

function authContext(values: Record<string, string | undefined>): AuthContext {
  return {
    env: async (name: string) => values[name],
    fileExists: async () => false,
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("createOpenferenceProviderComponent", () => {
  const pi = new FakeExtensionAPI()

  test("registers nothing without a credential", () => {
    // given an agent dir with no credential
    const dir = agentDir()

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: {} }).register(pi, ctx)

    // then no provider was registered and the agent dir stayed empty
    expect(pi.providers.length).toBe(0)
    expect(pi.providerConfigs.length).toBe(0)
    expect(readdirSync(dir)).toEqual([])
  })

  test("registers a complete provider in memory when the env credential exists", () => {
    // given the env credential
    const dir = agentDir()
    const before = pi.providers.length

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(pi, ctx)

    // then one provider was registered with the full catalog and the required header
    expect(pi.providers.length).toBe(before + 1)
    const provider = pi.providers[pi.providers.length - 1] as Provider
    expect(provider.id).toBe("openference")
    expect(provider.baseUrl).toBe(OPENFERENCE_BASE_URL)
    expect(provider.headers).toEqual({ "User-Agent": OPENFERENCE_USER_AGENT })
    expect(provider.auth.apiKey?.resolve).toBeDefined()

    const models = provider.getModels() as readonly Model<"openai-completions">[]
    expect(models.length).toBe(CATALOG_COUNT)
    expect(models.some((model) => model.id === "GLM-5.2")).toBe(true)
    expect(models.some((model) => model.id === "Kimi K2.7 Code")).toBe(true)
    const glm = models.find((model) => model.id === "GLM-5.2")
    expect(glm?.contextWindow).toBe(262144)
    expect(glm?.maxTokens).toBe(128000)
    expect(glm?.cost).toEqual({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 })
    expect(models.every((model) => model.baseUrl === OPENFERENCE_BASE_URL)).toBe(true)
    expect(models.every((model) => model.provider === "openference")).toBe(true)

    // and nothing was written to the agent dir
    expect(readdirSync(dir)).toEqual([])
  })

  test("resolves request auth from the stored credential first, then the env var", async () => {
    // given a registered provider
    const dir = agentDir()
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: {} }).register(pi, ctx)
    const provider = pi.providers[pi.providers.length - 1] as Provider
    const resolve = provider.auth.apiKey?.resolve
    if (resolve === undefined) throw new Error("apiKey auth missing")
    const signal = new AbortController().signal

    // when auth resolves against a stored credential, an ambient env var, and neither
    const fromStore = (await resolve({
      credential: { type: "api_key", key: "sk-stored" },
      ctx: authContext({}),
      signal,
    })) as AuthResult
    const fromEnv = (await resolve({
      credential: undefined,
      ctx: authContext({ [OPENFERENCE_ENV_VAR]: "sk-ambient" }),
      signal,
    })) as AuthResult
    const fromNothing = await resolve({
      credential: undefined,
      ctx: authContext({}),
      signal,
    })

    // then the stored key wins, ambient env still authenticates, and no
    // credential resolves to undefined so the engine owns availability instead
    // of a config entry that cannot work
    expect(fromStore).toEqual({ auth: { apiKey: "sk-stored" }, source: "stored API key" })
    expect(fromEnv).toEqual({ auth: { apiKey: "sk-ambient" }, source: OPENFERENCE_ENV_VAR })
    expect(fromNothing).toBeUndefined()
  })

  test("skips with a warning on hosts without registerProvider", () => {
    // given a host API whose provider registration is not available
    const dir = agentDir()
    const olderHost = new FakeExtensionAPI()
    ;(olderHost as { registerProvider?: unknown }).registerProvider = undefined

    // when the component registers with the credential present
    const { ctx, warnings } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: { [OPENFERENCE_ENV_VAR]: "sk-test" } }).register(
      olderHost as SenpiExtensionAPI,
      ctx,
    )

    // then it skipped instead of failing
    expect(warnings.length).toBe(1)
    expect(olderHost.providers.length).toBe(0)
  })

  test("registers from an auth.json openference entry instead of the env var", () => {
    // given auth.json with an openference login entry and no env credential
    const dir = agentDir()
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ openference: { type: "api_key", key: "sk-from-login" } }),
      "utf8",
    )
    const before = pi.providers.length

    // when the component registers
    const { ctx } = ctxWithLogger()
    createOpenferenceProviderComponent({ agentDir: dir, env: {} }).register(pi, ctx)

    // then the provider was registered and auth.json was left untouched
    expect(pi.providers.length).toBe(before + 1)
    expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8"))).toEqual({
      openference: { type: "api_key", key: "sk-from-login" },
    })
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

describe("production extension composes without filesystem effects", () => {
  const savedEnv: Record<string, string | undefined> = {}
  const pinnedVars = ["OPENFERENCE_API_KEY", "OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const

  function pinEnv(key: string, value: string | undefined): void {
    savedEnv[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  afterEach(() => {
    for (const key of pinnedVars) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
      delete savedEnv[key]
    }
  })

  test("composing the real extension with a credential present registers in memory and writes nothing", async () => {
    // given a credential in the environment and a temp agent dir pinned through
    // the same env vars the production roster reads
    const dir = agentDir()
    pinEnv(OPENFERENCE_ENV_VAR, "sk-test")
    pinEnv("OMO_CODING_AGENT_DIR", dir)
    pinEnv("SENPI_CODING_AGENT_DIR", dir)
    pinEnv("PI_CODING_AGENT_DIR", dir)
    const fakePi = new FakeExtensionAPI()

    // when the REAL extension entry composes and registers every component
    await extension(fakePi)

    // then the openference provider registered in memory and the pinned agent
    // dir gained no provider config: the composition path touches no user file
    // (regression guard for the models.json writer this component used before
    // the registerProvider redesign)
    expect(fakePi.providers.some((provider) => provider.id === "openference")).toBe(true)
    expect(existsSync(join(dir, "models.json"))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  test("composing the real extension without a credential registers no openference provider", async () => {
    // given no credential in the environment
    const dir = agentDir()
    pinEnv(OPENFERENCE_ENV_VAR, undefined)
    pinEnv("OMO_CODING_AGENT_DIR", dir)
    pinEnv("SENPI_CODING_AGENT_DIR", dir)
    pinEnv("PI_CODING_AGENT_DIR", dir)
    const fakePi = new FakeExtensionAPI()

    // when the real extension entry composes
    await extension(fakePi)

    // then no openference provider exists and the agent dir is untouched
    expect(fakePi.providers.some((provider) => provider.id === "openference")).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })
})
