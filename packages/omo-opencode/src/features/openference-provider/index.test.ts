/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { _resetProviderAuthCacheForTesting } from "../../shared/opencode-provider-auth"
import catalog from "./openference-models.json"
import {
  applyOpenferenceProviderConfig,
  OPENFERENCE_BASE_URL,
  OPENFERENCE_ENV_VAR,
  OPENFERENCE_PROVIDER_ID,
} from "./index"

const catalogIds = Object.keys(catalog as Record<string, unknown>)

type ProviderEntry = {
  readonly name?: unknown
  readonly npm?: unknown
  readonly env?: unknown
  readonly options?: Record<string, unknown>
  readonly models?: Record<string, unknown>
}

function readOpenference(config: Record<string, unknown>): ProviderEntry | undefined {
  const providers = config.provider as Record<string, ProviderEntry> | undefined
  return providers?.[OPENFERENCE_PROVIDER_ID]
}

describe("applyOpenferenceProviderConfig", () => {
  let tempDataDir: string
  const originalApiKey = process.env[OPENFERENCE_ENV_VAR]
  const originalXdgDataHome = process.env.XDG_DATA_HOME

  function writeAuthFile(contents: string): void {
    const opencodeDir = path.join(tempDataDir, "opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(path.join(opencodeDir, "auth.json"), contents, "utf-8")
    _resetProviderAuthCacheForTesting()
  }

  beforeEach(() => {
    tempDataDir = mkdtempSync(path.join(tmpdir(), "openference-provider-"))
    process.env.XDG_DATA_HOME = tempDataDir
    delete process.env[OPENFERENCE_ENV_VAR]
    _resetProviderAuthCacheForTesting()
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env[OPENFERENCE_ENV_VAR]
    } else {
      process.env[OPENFERENCE_ENV_VAR] = originalApiKey
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    rmSync(tempDataDir, { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()
  })

  test("injects the provider when the API key env var is set", () => {
    // given the Openference API key in the environment and a config with no provider block
    process.env[OPENFERENCE_ENV_VAR] = "sk-openference-test"
    const config: Record<string, unknown> = { model: "anthropic/claude-opus-4-7" }

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then the provider is registered with opencode's openai-compatible loader and the full catalog
    const provider = readOpenference(config)
    expect(provider?.name).toBe("Openference")
    expect(provider?.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider?.env).toEqual([OPENFERENCE_ENV_VAR])
    expect(provider?.options?.baseURL).toBe(OPENFERENCE_BASE_URL)
    expect(Object.keys(provider?.models ?? {}).length).toBe(catalogIds.length)
  })

  test("leaves the config untouched when no credential is available", () => {
    // given no API key env var and no auth.json entry
    const config: Record<string, unknown> = {
      model: "anthropic/claude-opus-4-7",
      provider: { anthropic: { options: { headers: {} } } },
    }
    const before = structuredClone(config)

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then the config is byte-identical to before
    expect(config).toEqual(before)
    expect(JSON.stringify(config)).toBe(JSON.stringify(before))
  })

  test("injects the provider when auth.json holds an openference entry", () => {
    // given auth.json with an api credential for openference and no env var
    writeAuthFile(JSON.stringify({ [OPENFERENCE_PROVIDER_ID]: { type: "api", key: "sk-from-auth" } }))
    const config: Record<string, unknown> = {}

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then the provider is injected from the auth-file credential
    expect(readOpenference(config)?.npm).toBe("@ai-sdk/openai-compatible")
    expect(Object.keys(readOpenference(config)?.models ?? {}).length).toBe(catalogIds.length)
  })

  test("ignores auth.json entries for other providers", () => {
    // given auth.json with credentials for an unrelated provider only
    writeAuthFile(JSON.stringify({ anthropic: { type: "oauth", access: "a" } }))
    const config: Record<string, unknown> = {}

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then nothing is injected
    expect(config.provider).toBeUndefined()
  })

  test("treats an empty API key env var as no credential", () => {
    // given an empty-string API key
    process.env[OPENFERENCE_ENV_VAR] = ""
    const config: Record<string, unknown> = {}

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then nothing is injected
    expect(config.provider).toBeUndefined()
  })

  test("preserves every user-set value and fills only the missing ones", () => {
    // given a user-authored openference provider with a custom baseURL and one custom model
    process.env[OPENFERENCE_ENV_VAR] = "sk-openference-test"
    const userModelId = "acme/private-model"
    const config: Record<string, unknown> = {
      provider: {
        [OPENFERENCE_PROVIDER_ID]: {
          name: "My Gateway",
          options: { baseURL: "https://proxy.internal/v1", apiKey: "inline-key" },
          models: { [userModelId]: { name: "Private Model" } },
        },
      },
    }

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then user values survive verbatim while catalog defaults fill the gaps
    const provider = readOpenference(config)
    expect(provider?.name).toBe("My Gateway")
    expect(provider?.options?.baseURL).toBe("https://proxy.internal/v1")
    expect(provider?.options?.apiKey).toBe("inline-key")
    expect(provider?.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider?.env).toEqual([OPENFERENCE_ENV_VAR])
    expect(provider?.models?.[userModelId]).toEqual({ name: "Private Model" })
    expect(Object.keys(provider?.models ?? {}).length).toBe(catalogIds.length + 1)
  })

  test("keeps a user override of a catalog model instead of the catalog entry", () => {
    // given the user redefining one catalog model id with a trimmed config
    process.env[OPENFERENCE_ENV_VAR] = "sk-openference-test"
    const overriddenId = catalogIds[0]
    if (overriddenId === undefined) throw new Error("catalog is empty")
    const config: Record<string, unknown> = {
      provider: {
        [OPENFERENCE_PROVIDER_ID]: { models: { [overriddenId]: { name: "Pinned", limit: { context: 1234, output: 56 } } } },
      },
    }

    // when the provider config is applied
    applyOpenferenceProviderConfig(config)

    // then the user's model entry is untouched and the rest of the catalog is added
    const provider = readOpenference(config)
    expect(provider?.models?.[overriddenId]).toEqual({ name: "Pinned", limit: { context: 1234, output: 56 } })
    expect(Object.keys(provider?.models ?? {}).length).toBe(catalogIds.length)
  })

  test("does not share catalog objects with the injected config", () => {
    // given a freshly injected provider
    process.env[OPENFERENCE_ENV_VAR] = "sk-openference-test"
    const config: Record<string, unknown> = {}
    applyOpenferenceProviderConfig(config)
    const firstId = catalogIds[0]
    if (firstId === undefined) throw new Error("catalog is empty")
    const injectedModels = readOpenference(config)?.models as Record<string, { name: string }>
    const injectedEntry = injectedModels[firstId]
    if (injectedEntry === undefined) throw new Error("catalog entry missing")

    // when the injected entry is mutated
    injectedEntry.name = "mutated"

    // then the module-level catalog is unaffected for the next injection
    const secondConfig: Record<string, unknown> = {}
    applyOpenferenceProviderConfig(secondConfig)
    const secondModels = readOpenference(secondConfig)?.models as Record<string, { name: string }>
    expect(secondModels[firstId]?.name).not.toBe("mutated")
  })
})
