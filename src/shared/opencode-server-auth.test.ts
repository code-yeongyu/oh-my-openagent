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

    let receivedHeadersConfig: { headers: Record<string, string> } | undefined
    const client = {
      _client: {
        setConfig: (config: { headers?: Record<string, string> }) => {
          if (config.headers) {
            receivedHeadersConfig = { headers: config.headers }
          }
        },
      },
    }

    injectServerAuthIntoClient(client)

    expect(receivedHeadersConfig).toEqual({
      headers: {
        Authorization: "Basic b3BlbmNvZGU6c2VjcmV0",
      },
    })
  })

  test("#given server password #when injecting wraps internal fetch #then wrapped fetch adds Authorization header", async () => {
    //#given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    type InternalConfig = {
      fetch?: (request: Request) => Promise<Response>
      headers?: Record<string, string>
    }

    let currentConfig: InternalConfig = {
      fetch: baseFetch,
      headers: {},
    }

    const client = {
      _client: {
        getConfig: (): InternalConfig => ({ ...currentConfig }),
        setConfig: (config: InternalConfig): InternalConfig => {
          currentConfig = { ...currentConfig, ...config }
          return { ...currentConfig }
        },
      },
    }

    //#when
    injectServerAuthIntoClient(client)
    if (!currentConfig.fetch) {
      throw new Error("expected fetch to be set")
    }
    await currentConfig.fetch(new Request("http://example.com"))

    //#then
    expect(receivedAuthorization ?? "").toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when internal has _config.fetch but no setConfig #then fetch is wrapped and injects Authorization", async () => {
    //#given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    const internal = {
      _config: {
        fetch: baseFetch,
      },
    }

    const client = {
      _client: internal,
    }

    //#when
    injectServerAuthIntoClient(client)
    await internal._config.fetch(new Request("http://example.com"))

    //#then
    expect(receivedAuthorization ?? "").toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when client has top-level fetch #then fetch is wrapped and injects Authorization", async () => {
    //#given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    const client = {
      fetch: baseFetch,
    }

    //#when
    injectServerAuthIntoClient(client)
    await client.fetch(new Request("http://example.com"))

    //#then
    expect(receivedAuthorization ?? "").toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given server password #when interceptors are available #then request interceptor injects Authorization", async () => {
    //#given
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    delete process.env.OPENCODE_SERVER_USERNAME

    let registeredInterceptor:
      | ((request: Request, options: { headers?: Headers }) => Promise<Request> | Request)
      | undefined

    const client = {
      _client: {
        interceptors: {
          request: {
            use: (
              interceptor: (request: Request, options: { headers?: Headers }) => Promise<Request> | Request
            ): number => {
              registeredInterceptor = interceptor
              return 0
            },
          },
        },
      },
    }

    //#when
    injectServerAuthIntoClient(client)
    if (!registeredInterceptor) {
      throw new Error("expected interceptor to be registered")
    }
    const request = new Request("http://example.com")
    const result = await registeredInterceptor(request, {})

    //#then
    expect(result.headers.get("Authorization")).toBe("Basic b3BlbmNvZGU6c2VjcmV0")
  })

  test("#given no server password #when injecting into client with fetch #then does not wrap fetch", async () => {
    //#given
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME

    let receivedAuthorization: string | null = null
    const baseFetch = async (request: Request): Promise<Response> => {
      receivedAuthorization = request.headers.get("Authorization")
      return new Response("ok")
    }

    type InternalConfig = { fetch?: (request: Request) => Promise<Response> }
    let currentConfig: InternalConfig = { fetch: baseFetch }
    let setConfigCalled = false

    const client = {
      _client: {
        getConfig: (): InternalConfig => ({ ...currentConfig }),
        setConfig: (config: InternalConfig): InternalConfig => {
          setConfigCalled = true
          currentConfig = { ...currentConfig, ...config }
          return { ...currentConfig }
        },
      },
    }

    //#when
    injectServerAuthIntoClient(client)
    if (!currentConfig.fetch) {
      throw new Error("expected fetch to exist")
    }
    await currentConfig.fetch(new Request("http://example.com"))

    //#then
    expect(setConfigCalled).toBe(false)
    expect(receivedAuthorization).toBeNull()
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
