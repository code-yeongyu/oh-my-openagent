import { describe, expect, test } from "bun:test"
import { keychainHelperDoctorLines, KEYCHAIN_HELPER_REQUIREMENT } from "../bin/lib/keychain-helper-doctor.js"
import { KEYCHAIN_HELPER_REQUIREMENT as BUILT_REQUIREMENT } from "../keychain-helper/build"

describe("omo doctor: keychain helper line (#11262 addendum Q1, row 9)", () => {
  test("#given the requirement doctor checks #when compared with the one the helper is built for #then they are identical", () => {
    expect(KEYCHAIN_HELPER_REQUIREMENT).toBe(BUILT_REQUIREMENT)
  })

  test.each([
    ["missing", false, false, "WARN keychain helper: missing"],
    ["damaged", true, false, "WARN keychain helper: bin/darwin/omo-keychain failed its signature check"],
    ["signed", true, true, "PASS keychain helper"],
  ] as const)("#given a %s helper on macOS #when doctor runs #then one line, never a failure", (_name, present, valid, prefix) => {
    const lines = keychainHelperDoctorLines({ packageRoot: "/pkg", platform: "darwin", exists: () => present, verify: () => valid })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.startsWith(prefix)).toBe(true)
    expect(lines.some(line => line.startsWith("FAIL"))).toBe(false)
  })

  test("#given the compiled runtime layout #when doctor runs #then it checks omo-keychain directly beside the binary (RULING-74)", () => {
    const seen: string[] = []
    const lines = keychainHelperDoctorLines({ packageRoot: "/opt/omo", helperRelPath: "omo-keychain", platform: "darwin", exists: path => {
        seen.push(String(path))
        return false
      },
      verify: () => false,
    })
    expect(seen).toEqual(["/opt/omo/omo-keychain"])
    expect(lines[0]).toContain("missing omo-keychain")
  })

  test.each(["linux", "win32"] as const)("#given %s #when doctor runs #then no keychain helper line", platform => {
    expect(keychainHelperDoctorLines({ packageRoot: "/pkg", platform, exists: () => false, verify: () => false })).toEqual([])
  })
})
