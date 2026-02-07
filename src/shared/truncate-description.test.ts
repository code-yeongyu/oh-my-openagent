import { describe, it, expect } from "bun:test"
import { truncateDescription } from "./truncate-description"

describe("truncateDescription", () => {
  it("returns description unchanged when under max length", () => {
    // given
    const description = "This is a short description"

    // when
    const result = truncateDescription(description)

    // then
    expect(result).toBe(description)
  })

  it("truncates to 120 characters by default and appends ellipsis", () => {
    // given
    const description = "This is a very long description that exceeds the default maximum length of 120 characters and should be truncated with an ellipsis at the end"

    // when
    const result = truncateDescription(description)

    // then
    expect(result.length).toBe(120) // 117 chars + "..."
    expect(result).toEndWith("...")
    expect(result).toBe(description.slice(0, 117) + "...")
  })

  it("respects custom max length parameter", () => {
    // given
    const description = "This is a description that is longer than fifty characters"
    const maxLength = 50

    // when
    const result = truncateDescription(description, maxLength)

    // then
    expect(result.length).toBe(50) // 47 chars + "..."
    expect(result).toEndWith("...")
    expect(result).toBe(description.slice(0, 47) + "...")
  })

  it("handles empty string", () => {
    // given
    const description = ""

    // when
    const result = truncateDescription(description)

    // then
    expect(result).toBe("")
  })

  it("handles exactly max length without truncation", () => {
    // given
    const description = "a".repeat(120)

    // when
    const result = truncateDescription(description)

    // then
    expect(result).toBe(description)
    expect(result).not.toEndWith("...")
  })

  it("handles description with periods correctly", () => {
    // given
    const description = "First sentence. Second sentence. Third sentence that is very long and continues beyond the normal truncation point with even more text to ensure it exceeds 120 characters."

    // when
    const result = truncateDescription(description)

    // then
    expect(result.length).toBe(120)
    expect(result).toContain("First sentence. Second sentence.")
    expect(result).toEndWith("...")
  })

  it("handles description with URLs correctly", () => {
    // given
    const description = "Check out https://example.com/very/long/path/that/contains/many/segments for more information about this feature and its capabilities"

    // when
    const result = truncateDescription(description)

    // then
    expect(result.length).toBe(120)
    expect(result).toStartWith("Check out https://example.com")
    expect(result).toEndWith("...")
  })

  it("handles description with version numbers correctly", () => {
    // given
    const description = "Version 1.2.3 of the library includes many improvements and bug fixes that make it more stable and performant with additional enhancements"

    // when
    const result = truncateDescription(description)

    // then
    expect(result.length).toBe(120)
    expect(result).toStartWith("Version 1.2.3")
    expect(result).toEndWith("...")
  })
})
