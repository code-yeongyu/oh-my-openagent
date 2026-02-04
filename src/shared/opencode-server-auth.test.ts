/// <reference types="bun-types" />

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getServerBasicAuthHeader, injectServerAuthIntoClient } from "./opencode-server-auth"

describe("opencode-server-auth", () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD,
      OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME,
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  test("#given no server password #when building auth header #then returns undefined", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD

    const result = getServerBasicAuthHeader()

    expect(result).toBeUndefined()
  })

  test("#given server password without username #when building auth header #then uses default username", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    const result = getServerBasicAuthHeader()

    expect(result).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password and username #when building auth header #then uses provided username", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "dan"

    const result = getServerBasicAuthHeader()

    expect(result).toBe("Basic ZGFuOnNlY3JldA==")
  })

  test("#given server password #when injecting into client #then updates client headers", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedConfig: { headers: Record<string, string> } | undefined
    const client = {
      _client: {
        setConfig: (config: { headers: Record<string, string> }) => {
          receivedConfig = config
        },
      },
    }

    injectServerAuthIntoClient(client)

    expect(receivedConfig).toEqual({
      headers: {
        Authorization: "Basic b3BlbmNvZGU6c2VjcmV0",
      },
    })
  })

  test("#given server password #when client has no _client #then does not throw", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    const client = {}

    expect(() => injectServerAuthIntoClient(client)).not.toThrow()
  })

  test("#given server password #when client._client has no setConfig #then does not throw", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    const client = { _client: {} }

    expect(() => injectServerAuthIntoClient(client)).not.toThrow()
  })

  test("#given no server password #when client is invalid #then does not throw", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD
    const client = {}

    expect(() => injectServerAuthIntoClient(client)).not.toThrow()
  })
})
