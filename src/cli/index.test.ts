import { describe, it, expect } from "bun:test"
import packageJson from "../../package.json" with { type: "json" }

describe("CLI version", () => {
  it("reads version from package.json as valid semver", () => {
    //#given
    const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/

    //#when
    const version = packageJson.version

    //#then
    expect(version).toMatch(semverRegex)
    expect(typeof version).toBe("string")
    expect(version.length).toBeGreaterThan(0)
  })
})
