import { describe, expect, it } from "bun:test"
import {
  getOrRegisterClient,
  type ClientCredentials,
  type ClientRegistrationStorage,
  type DcrFetch,
} from "./dcr"

function createStorage(initial: ClientCredentials | null):
  & ClientRegistrationStorage
  & { getLastKey: () => string | null; getLastSet: () => ClientCredentials | null } {
  let stored = initial
  let lastKey: string | null = null
  let lastSet: ClientCredentials | null = null

  return {
    getClientRegistration: () => stored,
    setClientRegistration: (serverIdentifier: string, credentials: ClientCredentials) => {
      lastKey = serverIdentifier
      lastSet = credentials
      stored = credentials
    },
    getLastKey: () => lastKey,
    getLastSet: () => lastSet,
  }
}

describe("getOrRegisterClient", () => {
  it("returns cached registration when available", async () => {
    // #given
    const storage = createStorage({
      clientId: "cached-client",
      clientSecret: "cached-secret",
    })
    const fetchMock: DcrFetch = async () => {
      throw new Error("fetch should not be called")
    }

    // #when
    const result = await getOrRegisterClient({
      registrationEndpoint: "https://server.example.com/register",
      serverIdentifier: "server-1",
      clientName: "Test Client",
      redirectUris: ["https://app.example.com/callback"],
      tokenEndpointAuthMethod: "client_secret_post",
      storage,
      fetch: fetchMock,
    })

    // #then
    expect(result).toEqual({
      clientId: "cached-client",
      clientSecret: "cached-secret",
    })
  })

  it("registers client and stores credentials when endpoint available", async () => {
    // #given
    const storage = createStorage(null)
    let fetchCalled = false
    const fetchMock: DcrFetch = async (
      input: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => {
      fetchCalled = true
      expect(input).toBe("https://server.example.com/register")
      if (typeof init?.body !== "string") {
        throw new Error("Expected request body string")
      }
      const payload = JSON.parse(init.body)
      expect(payload).toEqual({
        redirect_uris: ["https://app.example.com/callback"],
        client_name: "Test Client",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      })

      return {
        ok: true,
        json: async () => ({
          client_id: "registered-client",
          client_secret: "registered-secret",
        }),
      }
    }

    // #when
    const result = await getOrRegisterClient({
      registrationEndpoint: "https://server.example.com/register",
      serverIdentifier: "server-2",
      clientName: "Test Client",
      redirectUris: ["https://app.example.com/callback"],
      tokenEndpointAuthMethod: "client_secret_post",
      storage,
      fetch: fetchMock,
    })

    // #then
    expect(fetchCalled).toBe(true)
    expect(result).toEqual({
      clientId: "registered-client",
      clientSecret: "registered-secret",
    })
    expect(storage.getLastKey()).toBe("server-2")
    expect(storage.getLastSet()).toEqual({
      clientId: "registered-client",
      clientSecret: "registered-secret",
    })
  })

  it("uses config client id when registration endpoint missing", async () => {
    // #given
    const storage = createStorage(null)
    let fetchCalled = false
    const fetchMock: DcrFetch = async () => {
      fetchCalled = true
      return {
        ok: false,
        json: async () => ({}),
      }
    }

    // #when
    const result = await getOrRegisterClient({
      registrationEndpoint: undefined,
      serverIdentifier: "server-3",
      clientName: "Test Client",
      redirectUris: ["https://app.example.com/callback"],
      tokenEndpointAuthMethod: "client_secret_post",
      clientId: "config-client",
      storage,
      fetch: fetchMock,
    })

    // #then
    expect(fetchCalled).toBe(false)
    expect(result).toEqual({ clientId: "config-client" })
  })

  it("falls back to config client id when registration fails", async () => {
    // #given
    const storage = createStorage(null)
    const fetchMock: DcrFetch = async () => {
      throw new Error("network error")
    }

    // #when
    const result = await getOrRegisterClient({
      registrationEndpoint: "https://server.example.com/register",
      serverIdentifier: "server-4",
      clientName: "Test Client",
      redirectUris: ["https://app.example.com/callback"],
      tokenEndpointAuthMethod: "client_secret_post",
      clientId: "fallback-client",
      storage,
      fetch: fetchMock,
    })

    // #then
    expect(result).toEqual({ clientId: "fallback-client" })
    expect(storage.getLastSet()).toBeNull()
  })
})
