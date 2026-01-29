/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { McpOauthSchema } from "./schema"

describe("McpOauthSchema", () => {
  test("parses empty oauth config", () => {
    //#given
    const input = {}

    //#when
    const result = McpOauthSchema.parse(input)

    //#then
    expect(result).toEqual({})
  })

  test("parses oauth config with clientId", () => {
    //#given
    const input = { clientId: "client-123" }

    //#when
    const result = McpOauthSchema.parse(input)

    //#then
    expect(result).toEqual({ clientId: "client-123" })
  })

  test("parses oauth config with scopes", () => {
    //#given
    const input = { scopes: ["openid", "profile"] }

    //#when
    const result = McpOauthSchema.parse(input)

    //#then
    expect(result).toEqual({ scopes: ["openid", "profile"] })
  })

  test("rejects non-string clientId", () => {
    //#given
    const input = { clientId: 123 }

    //#when
    const result = McpOauthSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects non-string scopes", () => {
    //#given
    const input = { scopes: ["openid", 42] }

    //#when
    const result = McpOauthSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })
})
