import { describe, expect, it } from "bun:test"
import { parseFirstExecutablePath } from "./constants"

describe("parseFirstExecutablePath (#4512)", () => {
  it("strips the trailing CR from CRLF-delimited where.exe output", () => {
    // #given Windows where.exe returns CRLF-delimited paths
    const stdout = "C:\\Program Files\\rg\\rg.exe\r\nC:\\other\\rg.exe\r\n"

    // #when parsing the first executable path
    const resolved = parseFirstExecutablePath(stdout)

    // #then the resolved path has no trailing carriage return
    expect(resolved).toBe("C:\\Program Files\\rg\\rg.exe")
    expect(resolved?.includes("\r")).toBe(false)
  })

  it("returns the first line for LF-delimited which output", () => {
    // #given a Unix which returns LF-delimited paths
    const stdout = "/usr/bin/rg\n/usr/local/bin/rg\n"

    // #when parsing the first executable path
    const resolved = parseFirstExecutablePath(stdout)

    // #then the first path is returned untouched
    expect(resolved).toBe("/usr/bin/rg")
  })

  it("trims surrounding whitespace from a single-line result", () => {
    // #given output padded with spaces and a trailing CRLF
    const stdout = "  C:\\tools\\rg.exe  \r\n"

    // #when parsing the first executable path
    const resolved = parseFirstExecutablePath(stdout)

    // #then the path is trimmed on both ends
    expect(resolved).toBe("C:\\tools\\rg.exe")
  })

  it("returns null for empty or whitespace-only output", () => {
    // #given no executable was found
    // #when parsing empty and whitespace-only output
    // #then null is returned in both cases
    expect(parseFirstExecutablePath("")).toBeNull()
    expect(parseFirstExecutablePath("\r\n")).toBeNull()
    expect(parseFirstExecutablePath("   \r\n")).toBeNull()
  })
})
