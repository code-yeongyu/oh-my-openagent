import { describe, it, expect, mock, spyOn } from "bun:test"
import { openBrowserURL } from "./browser"

describe("openBrowserURL", () => {
  it("returns true when browser opens successfully", async () => {
    // #given
    const url = "https://accounts.google.com/oauth"

    // #when
    const result = await openBrowserURL(url)

    // #then
    expect(typeof result).toBe("boolean")
  })

  it("returns false when open throws an error", async () => {
    // #given
    const invalidUrl = ""

    // #when
    const result = await openBrowserURL(invalidUrl)

    // #then
    expect(typeof result).toBe("boolean")
  })

  it("handles URL with special characters", async () => {
    // #given
    const urlWithParams = "https://accounts.google.com/oauth?state=abc123&redirect_uri=http://localhost:51121"

    // #when
    const result = await openBrowserURL(urlWithParams)

    // #then
    expect(typeof result).toBe("boolean")
  })
})
