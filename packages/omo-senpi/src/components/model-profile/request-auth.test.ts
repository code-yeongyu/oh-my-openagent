/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { AuthStorage, ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import { createModelProfileComponent, MODEL_PROFILE_APPLIED_TYPE, MODEL_PROFILE_UNAVAILABLE_TYPE } from "./index"
import { sanitizedAuthErrorDetail } from "./request-auth"

const PRIVATE_MARKER = "SYNTHETIC_PRIVATE_MARKER_0a1b2c3d4e5f"
const FAR_FUTURE = Date.now() + 24 * 60 * 60 * 1000

function fixtureModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  }
}

// An extension OAuth provider whose token exchange rejects every refresh token listed in
// `rejectedRefreshTokens`, recording each attempt; a healthy account never reaches the exchange.
function oauthFixture(rejectedRefreshTokens: readonly string[], refreshAttempts: string[]) {
  return {
    name: "Pool fixture",
    async login(): Promise<never> {
      throw new Error("login is not part of this fixture")
    },
    async refreshToken(credentials: { refresh: string; access: string; expires: number }) {
      refreshAttempts.push(credentials.refresh)
      if (rejectedRefreshTokens.includes(credentials.refresh)) {
        throw new Error(`token exchange rejected: body={"error":"invalid_grant","marker":"${PRIVATE_MARKER}"}`)
      }
      return { ...credentials, access: "renewed-access", expires: FAR_FUTURE }
    },
    getApiKey(credentials: { access: string }) {
      return credentials.access
    },
  }
}

function oauthAccount(name: string, expires: number) {
  return { name, source: "login" as const, access: `${name}-access`, refresh: `${name}-refresh`, expires }
}

async function realRegistry(seed: Record<string, unknown>, register: (registry: InstanceType<typeof ModelRegistry>) => void) {
  const registry = ModelRegistry.inMemory(AuthStorage.inMemory(seed))
  register(registry)
  await registry.refresh({ allowNetwork: false })
  return registry
}

// The engine reads `credentials.rotation` from models.json, so this registry is built the way senpi
// builds a session's: a runtime over `<agentDir>/models.json` sharing one credential store.
async function realRegistryWithModelsJson(
  seed: Record<string, unknown>,
  modelsJson: Record<string, unknown>,
  register: (registry: InstanceType<typeof ModelRegistry>) => void,
) {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-model-profile-rotation-"))
  const modelsPath = join(agentDir, "models.json")
  writeFileSync(modelsPath, JSON.stringify(modelsJson))
  const storage = AuthStorage.inMemory(seed)
  const runtime = ModelRuntime.createSync({ credentials: storage, modelsPath, agentDir })
  const registry = new ModelRegistry(runtime, storage)
  register(registry)
  await registry.refresh({ allowNetwork: false })
  return { registry, agentDir }
}

function drive(config: OmoConfig, registry: InstanceType<typeof ModelRegistry>, agentDir = mkdtempSync(join(tmpdir(), "omo-model-profile-real-"))) {
  const pi = new FakeExtensionAPI()
  const logs: string[] = []
  const ctx: ComponentContext = {
    config: { getFlag: () => undefined },
    logger: { error() {}, info: (message) => logs.push(`info:${message}`), warn: (message) => logs.push(`warn:${message}`) },
  }
  createModelProfileComponent({ loadConfig: () => ({ config, diagnostics: [], layers: [], sources: [] }) }).register(pi, ctx)
  const start = () =>
    pi.dispatch(
      "session_start",
      { type: "session_start", reason: "startup", initialModelProvenance: "settings" },
      {
        mode: "rpc",
        cwd: "/project",
        agentDir,
        modelRegistry: registry,
        sessionManager: { getSessionId: () => "session-real" },
      },
    )
  return { pi, logs, start }
}

describe("probeRequestAuth against senpi's real ModelRegistry", () => {
  test("#given a credential pool whose flat account no longer refreshes but a sibling account is valid #when the session starts #then the pooled provider is applied through the healthy slot", async () => {
    // given: the flat projection (what `getApiKeyAndHeaders` resolves) is the expired account, while
    // the engine's first turn rotates onto `healthy`
    const refreshAttempts: string[] = []
    const expired = oauthAccount("expired", 0)
    const healthy = oauthAccount("healthy", FAR_FUTURE)
    const registry = await realRegistry(
      {
        "pool-fixture": {
          type: "oauth",
          access: expired.access,
          refresh: expired.refresh,
          expires: expired.expires,
          accounts: [expired, healthy],
        },
      },
      (registry) =>
        registry.registerProvider("pool-fixture", {
          api: "openai-completions",
          baseUrl: "https://example.invalid",
          models: [fixtureModel("pooled-1")],
          oauth: oauthFixture([expired.refresh], refreshAttempts),
        }),
    )
    const model = registry.find("pool-fixture", "pooled-1")
    expect(model).toBeDefined()
    expect(await registry.getApiKeyAndHeaders(model!)).toMatchObject({ ok: false })
    const attemptsBeforeStart = refreshAttempts.length

    // when
    const { pi, start } = drive({ model_profile: "pooled", model_profiles: { pooled: { models: ["pool-fixture/pooled-1"] } } }, registry)
    await start()

    // then
    expect(pi.sessionModels).toEqual([model])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_APPLIED_TYPE })
    expect(pi.messages[0]?.message["details"]).not.toHaveProperty("authFailed")
    expect(refreshAttempts.slice(attemptsBeforeStart)).toEqual([expired.refresh])
  })

  test("#given a credential pool pinned to an account that no longer refreshes #when the session starts #then the pin is honored and the provider is skipped with a refresh reason", async () => {
    const refreshAttempts: string[] = []
    const expired = oauthAccount("expired", 0)
    const healthy = oauthAccount("healthy", FAR_FUTURE)
    const registry = await realRegistry(
      {
        "pool-fixture": {
          type: "oauth",
          access: healthy.access,
          refresh: healthy.refresh,
          expires: healthy.expires,
          accounts: [healthy, expired],
          pinned: "expired",
        },
      },
      (registry) =>
        registry.registerProvider("pool-fixture", {
          api: "openai-completions",
          baseUrl: "https://example.invalid",
          models: [fixtureModel("pooled-1")],
          oauth: oauthFixture([expired.refresh], refreshAttempts),
        }),
    )

    const { pi, logs, start } = drive({ model_profile: "pooled", model_profiles: { pooled: { models: ["pool-fixture/pooled-1"] } } }, registry)
    await start()

    expect(pi.sessionModels).toEqual([])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(pi.messages[0]?.message["details"]).toEqual({
      profile: "pooled",
      authFailed: [{ provider: "pool-fixture", model: "pooled-1", reason: "refresh" }],
    })
    expect(refreshAttempts).toEqual([expired.refresh])
    expect(JSON.stringify(pi.messages[0]?.message)).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
  })

  test("#given a pool with a valid sibling but models.json disabling rotation for the provider #when the session starts #then the rejected flat credential decides and the provider is skipped", async () => {
    // given: the same pool the rotating test keeps eligible, but the engine will not rotate it, so
    // its first turn resolves only the flat (expired, rejected) credential
    const refreshAttempts: string[] = []
    const expired = oauthAccount("expired", 0)
    const healthy = oauthAccount("healthy", FAR_FUTURE)
    const { registry, agentDir } = await realRegistryWithModelsJson(
      {
        "pool-fixture": {
          type: "oauth",
          access: expired.access,
          refresh: expired.refresh,
          expires: expired.expires,
          accounts: [expired, healthy],
        },
      },
      // models.json needs one request field on a provider entry; the registered baseUrl is repeated.
      { providers: { "pool-fixture": { baseUrl: "https://example.invalid", credentials: { rotation: false } } } },
      (registry) =>
        registry.registerProvider("pool-fixture", {
          api: "openai-completions",
          baseUrl: "https://example.invalid",
          models: [fixtureModel("pooled-1")],
          oauth: oauthFixture([expired.refresh], refreshAttempts),
        }),
    )

    // when
    const { pi, start } = drive({ model_profile: "pooled", model_profiles: { pooled: { models: ["pool-fixture/pooled-1"] } } }, registry, agentDir)
    await start()

    // then
    expect(pi.sessionModels).toEqual([])
    expect(pi.messages[0]?.message).toMatchObject({ customType: MODEL_PROFILE_UNAVAILABLE_TYPE })
    expect(pi.messages[0]?.message["details"]).toEqual({
      profile: "pooled",
      authFailed: [{ provider: "pool-fixture", model: "pooled-1", reason: "refresh" }],
    })
    expect(refreshAttempts).toEqual([expired.refresh])
  })

  test("#given one model whose configured header cannot resolve on a provider with a working key #when the session starts #then only that model is skipped and the sibling is applied", async () => {
    const registry = await realRegistry({}, (registry) =>
      registry.registerProvider("headers-fixture", {
        api: "openai-completions",
        baseUrl: "https://example.invalid",
        apiKey: "fixture-key",
        models: [
          { ...fixtureModel("broken"), headers: { "x-token": `$OMO_MODEL_PROFILE_TEST_UNSET_${PRIVATE_MARKER}` } },
          fixtureModel("healthy"),
        ],
      }),
    )
    const broken = registry.find("headers-fixture", "broken")
    const healthy = registry.find("headers-fixture", "healthy")
    expect(await registry.getApiKeyAndHeaders(broken!)).toMatchObject({ ok: false })
    expect(await registry.getApiKeyAndHeaders(healthy!)).toMatchObject({ ok: true })

    const { pi, logs, start } = drive(
      { model_profile: "hdr", model_profiles: { hdr: { models: ["headers-fixture/broken", "headers-fixture/healthy"] } } },
      registry,
    )
    await start()

    expect(pi.sessionModels).toEqual([healthy])
    expect(pi.messages[0]?.message["details"]).toMatchObject({
      model: "headers-fixture/healthy",
      authFailed: [{ provider: "headers-fixture", model: "broken", reason: "request" }],
    })
    expect(JSON.stringify(pi.messages[0]?.message)).not.toContain(PRIVATE_MARKER)
    expect(logs.some((line) => line.includes(PRIVATE_MARKER))).toBe(false)
  })
})

describe("sanitizedAuthErrorDetail", () => {
  test("#given senpi's refresh error chain with a response body #when sanitized #then the class chain survives and the body does not", () => {
    const exchange = new Error("OAuth token exchange failed", {
      cause: new Error(`Anthropic token refresh request failed. url=https://example.invalid/token; details=Error: body={"marker":"${PRIVATE_MARKER}"}`),
    })
    exchange.name = "OAuthRefreshExchangeError"
    const error = Object.assign(new Error(`OAuth refresh failed for anthropic: ${exchange.message}`, { cause: exchange }), { code: "oauth" })
    error.name = "ModelsError"

    const detail = sanitizedAuthErrorDetail(error)

    expect(detail).toContain("ModelsError")
    expect(detail).toContain("OAuthRefreshExchangeError")
    expect(detail).not.toContain(PRIVATE_MARKER)
  })

  test("#given a failing config command quoted in the message #when sanitized #then the command is redacted", () => {
    const detail = sanitizedAuthErrorDetail(new Error(`Failed to resolve API key from shell command: cat ~/secrets/${PRIVATE_MARKER}`))

    expect(detail).toBe("Error: Failed to resolve API key from shell command: <redacted>")
  })

  test.each([
    ["a bearer authorization header", "401: request failed with Authorization: Bearer sk-9q2"],
    ["a bare bearer credential", "refresh rejected for bearer sk-9q2"],
    ["a JSON access token", 'token exchange failed: {"access_token":"sk-9q2","expires_in":0}'],
    ["a JSON refresh token", "token exchange failed: {'refresh_token': 'sk-9q2'}"],
    ["an api key assignment", "invalid request api_key=sk-9q2&model=m"],
    ["a token in a URL query", "GET https://example.invalid/v1/models?key=sk-9q2 failed"],
    ["URL userinfo", "connect https://user:sk-9q2@example.invalid/v1 refused"],
    ["an x-api-key header", "403: x-api-key: sk-9q2 is not allowed"],
  ])("#given %s holding a short secret #when sanitized #then the secret does not survive", (_label, message) => {
    expect(sanitizedAuthErrorDetail(new Error(message))).not.toContain("sk-9q2")
  })

  test("#given key-shaped assignments, long opaque strings and a stack #when sanitized #then each is masked and the line is bounded", () => {
    const error = new Error(`token=abc123 key: ${"x".repeat(40)} stack=at somewhere\nsecond line with ${PRIVATE_MARKER}`)

    const detail = sanitizedAuthErrorDetail(error)

    expect(detail).not.toContain("abc123")
    expect(detail).not.toContain("x".repeat(40))
    expect(detail).not.toContain("somewhere")
    expect(detail).not.toContain(PRIVATE_MARKER)
    expect(detail.length).toBeLessThanOrEqual(240)
  })
})
