import { describe, expect, it } from "bun:test"
import { addResourceToParams, getResourceIndicator } from "./resource-indicator"

describe("getResourceIndicator", () => {
  it("returns URL unchanged when already normalized", () => {
    // #given
    const url = "https://mcp.example.com"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com")
  })

  it("strips trailing slash", () => {
    // #given
    const url = "https://mcp.example.com/"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com")
  })

  it("strips query parameters", () => {
    // #given
    const url = "https://mcp.example.com/v1?token=abc&debug=true"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com/v1")
  })

  it("strips fragment", () => {
    // #given
    const url = "https://mcp.example.com/v1#section"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com/v1")
  })

  it("strips query and trailing slash together", () => {
    // #given
    const url = "https://mcp.example.com/api/?key=val"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com/api")
  })

  it("preserves path segments", () => {
    // #given
    const url = "https://mcp.example.com/org/project/v2"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com/org/project/v2")
  })

  it("preserves port number", () => {
    // #given
    const url = "https://mcp.example.com:8443/api/"

    // #when
    const result = getResourceIndicator(url)

    // #then
    expect(result).toBe("https://mcp.example.com:8443/api")
  })
})

describe("addResourceToParams", () => {
  it("sets resource parameter on empty params", () => {
    // #given
    const params = new URLSearchParams()
    const resource = "https://mcp.example.com"

    // #when
    addResourceToParams(params, resource)

    // #then
    expect(params.get("resource")).toBe("https://mcp.example.com")
  })

  it("adds resource alongside existing parameters", () => {
    // #given
    const params = new URLSearchParams({ grant_type: "authorization_code" })
    const resource = "https://mcp.example.com/v1"

    // #when
    addResourceToParams(params, resource)

    // #then
    expect(params.get("grant_type")).toBe("authorization_code")
    expect(params.get("resource")).toBe("https://mcp.example.com/v1")
  })

  it("overwrites existing resource parameter", () => {
    // #given
    const params = new URLSearchParams({ resource: "https://old.example.com" })
    const resource = "https://new.example.com"

    // #when
    addResourceToParams(params, resource)

    // #then
    expect(params.get("resource")).toBe("https://new.example.com")
    expect(params.getAll("resource")).toHaveLength(1)
  })
})
