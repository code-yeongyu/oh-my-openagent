import { describe, expect, test } from "bun:test"
import { extractCurrentSection, stampCurrentSection } from "./changelog-section"

describe("current changelog section", () => {
  test("stamps and extracts exactly", () => {
    const stamped = stampCurrentSection("# Changelog\n", "## 5.0.0-beta.53")
    expect(extractCurrentSection(stamped)).toBe("## 5.0.0-beta.53")
    expect(() => stampCurrentSection(stamped, "x")).toThrow()
  })
  test("fails closed for malformed markers", () => {
    expect(() => extractCurrentSection("# Changelog")).toThrow()
    expect(() => extractCurrentSection("<!-- omo:current-releases:start -->\n<!-- omo:current-releases:end -->")).toThrow()
  })
})
