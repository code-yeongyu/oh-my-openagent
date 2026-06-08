import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import {
  _resetProviderAuthCacheForTesting,
  getProviderAuthType,
  isProviderUsingOAuth,
} from "./opencode-provider-auth"

describe("opencode-provider-auth", () => {
  let tempDataDir: string
  const originalXdgDataHome = process.env.XDG_DATA_HOME

  function writeAuthFile(contents: string): void {
    const opencodeDir = path.join(tempDataDir, "opencode")
    mkdirSync(opencodeDir, { recursive: true })
    writeFileSync(path.join(opencodeDir, "auth.json"), contents, "utf-8")
    _resetProviderAuthCacheForTesting()
  }

  beforeAll(() => {
    tempDataDir = path.join(tmpdir(), `opencode-provider-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDataDir, { recursive: true })
    process.env.XDG_DATA_HOME = tempDataDir
  })

  afterAll(() => {
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    rmSync(tempDataDir, { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()
  })

  afterEach(() => {
    _resetProviderAuthCacheForTesting()
  })

  it("#given auth.json with oauth entry #then detects OAuth for that provider", () => {
    // given auth.json where anthropic is OAuth
    writeAuthFile(JSON.stringify({
      anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
      opencode: { type: "api", key: "sk-x" },
    }))

    // when isProviderUsingOAuth queries each provider
    const anthropicOauth = isProviderUsingOAuth("anthropic")
    const opencodeOauth = isProviderUsingOAuth("opencode")

    // then only OAuth providers return true
    expect(anthropicOauth).toBe(true)
    expect(opencodeOauth).toBe(false)
  })

  it("#given api-key auth.json entry #then returns the api auth type", () => {
    // given auth.json with an API key for anthropic
    writeAuthFile(JSON.stringify({ anthropic: { type: "api", key: "sk-ant-xxx" } }))

    // when getProviderAuthType queries the provider
    const authType = getProviderAuthType("anthropic")

    // then the api type is returned
    expect(authType).toBe("api")
    expect(isProviderUsingOAuth("anthropic")).toBe(false)
  })

  it("#given missing auth.json #then returns undefined with no throw", () => {
    // given no auth.json exists (XDG_DATA_HOME points to an empty dir)
    rmSync(path.join(tempDataDir, "opencode"), { recursive: true, force: true })
    _resetProviderAuthCacheForTesting()

    // when isProviderUsingOAuth queries a provider
    const anthropicOauth = isProviderUsingOAuth("anthropic")
    const anthropicType = getProviderAuthType("anthropic")

    // then callers get a safe undefined/false
    expect(anthropicOauth).toBe(false)
    expect(anthropicType).toBeUndefined()
  })

  it("#given malformed auth.json #then does not throw and returns undefined", () => {
    // given a malformed JSON auth file
    writeAuthFile("not json at all")

    // when isProviderUsingOAuth queries a provider
    const anthropicOauth = isProviderUsingOAuth("anthropic")

    // then detection degrades safely
    expect(anthropicOauth).toBe(false)
  })

  it("#given unknown provider #then returns undefined", () => {
    // given auth.json without an entry for the queried provider
    writeAuthFile(JSON.stringify({ anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } }))

    // when querying a provider that is not present
    const openai = getProviderAuthType("openai")

    // then undefined
    expect(openai).toBeUndefined()
    expect(isProviderUsingOAuth("openai")).toBe(false)
  })
})
