import { describe, expect, it } from "bun:test"
import { isStepUpRequired, mergeScopes, parseWwwAuthenticate } from "./step-up"

describe("parseWwwAuthenticate", () => {
  it("parses scope from simple Bearer header", () => {
    // #given
    const header = 'Bearer scope="read write"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toEqual({ requiredScopes: ["read", "write"] })
  })

  it("parses scope with error fields", () => {
    // #given
    const header = 'Bearer error="insufficient_scope", scope="admin"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toEqual({
      requiredScopes: ["admin"],
      error: "insufficient_scope",
    })
  })

  it("parses all fields including error_description", () => {
    // #given
    const header =
      'Bearer realm="example", error="insufficient_scope", error_description="Need admin access", scope="admin write"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toEqual({
      requiredScopes: ["admin", "write"],
      error: "insufficient_scope",
      errorDescription: "Need admin access",
    })
  })

  it("returns null for non-Bearer scheme", () => {
    // #given
    const header = 'Basic realm="example"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toBeNull()
  })

  it("returns null when no scope parameter present", () => {
    // #given
    const header = 'Bearer error="invalid_token"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toBeNull()
  })

  it("returns null for empty scope value", () => {
    // #given
    const header = 'Bearer scope=""'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toBeNull()
  })

  it("returns null for bare Bearer with no params", () => {
    // #given
    const header = "Bearer"

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toBeNull()
  })

  it("handles case-insensitive Bearer prefix", () => {
    // #given
    const header = 'bearer scope="read"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toEqual({ requiredScopes: ["read"] })
  })

  it("parses single scope value", () => {
    // #given
    const header = 'Bearer scope="admin"'

    // #when
    const result = parseWwwAuthenticate(header)

    // #then
    expect(result).toEqual({ requiredScopes: ["admin"] })
  })
})

describe("mergeScopes", () => {
  it("merges new scopes into existing", () => {
    // #given
    const existing = ["read", "write"]
    const required = ["admin", "write"]

    // #when
    const result = mergeScopes(existing, required)

    // #then
    expect(result).toEqual(["read", "write", "admin"])
  })

  it("returns required when existing is empty", () => {
    // #given
    const existing: string[] = []
    const required = ["read", "write"]

    // #when
    const result = mergeScopes(existing, required)

    // #then
    expect(result).toEqual(["read", "write"])
  })

  it("returns existing when required is empty", () => {
    // #given
    const existing = ["read"]
    const required: string[] = []

    // #when
    const result = mergeScopes(existing, required)

    // #then
    expect(result).toEqual(["read"])
  })

  it("deduplicates identical scopes", () => {
    // #given
    const existing = ["read", "write"]
    const required = ["read", "write"]

    // #when
    const result = mergeScopes(existing, required)

    // #then
    expect(result).toEqual(["read", "write"])
  })
})

describe("isStepUpRequired", () => {
  it("returns step-up info for 403 with WWW-Authenticate", () => {
    // #given
    const statusCode = 403
    const headers = { "www-authenticate": 'Bearer scope="admin"' }

    // #when
    const result = isStepUpRequired(statusCode, headers)

    // #then
    expect(result).toEqual({ requiredScopes: ["admin"] })
  })

  it("returns null for non-403 status", () => {
    // #given
    const statusCode = 401
    const headers = { "www-authenticate": 'Bearer scope="admin"' }

    // #when
    const result = isStepUpRequired(statusCode, headers)

    // #then
    expect(result).toBeNull()
  })

  it("returns null when no WWW-Authenticate header", () => {
    // #given
    const statusCode = 403
    const headers = { "content-type": "application/json" }

    // #when
    const result = isStepUpRequired(statusCode, headers)

    // #then
    expect(result).toBeNull()
  })

  it("handles capitalized WWW-Authenticate header", () => {
    // #given
    const statusCode = 403
    const headers = { "WWW-Authenticate": 'Bearer scope="read write"' }

    // #when
    const result = isStepUpRequired(statusCode, headers)

    // #then
    expect(result).toEqual({ requiredScopes: ["read", "write"] })
  })

  it("returns null for 403 with unparseable WWW-Authenticate", () => {
    // #given
    const statusCode = 403
    const headers = { "www-authenticate": 'Basic realm="example"' }

    // #when
    const result = isStepUpRequired(statusCode, headers)

    // #then
    expect(result).toBeNull()
  })
})
