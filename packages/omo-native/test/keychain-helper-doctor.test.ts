import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  ] as const)(
    "#given a %s helper on macOS #when doctor runs #then one line, never a failure",
    (_name, present, valid, prefix) => {
      const lines = keychainHelperDoctorLines({
        packageRoot: "/pkg",
        platform: "darwin",
        exists: () => present,
        verify: () => valid,
        stat: () => null,
      })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.startsWith(prefix)).toBe(true)
      expect(lines.some((line) => line.startsWith("FAIL"))).toBe(false)
    },
  )

  test("#given the compiled runtime layout #when doctor runs #then it checks omo-keychain directly beside the binary (RULING-74)", () => {
    const seen: string[] = []
    const lines = keychainHelperDoctorLines({
      packageRoot: "/opt/omo",
      helperRelPath: "omo-keychain",
      platform: "darwin",
      exists: (path) => {
        seen.push(String(path))
        return false
      },
      verify: () => false,
    })
    expect(seen).toEqual([join("/opt/omo", "omo-keychain")])
    expect(lines[0]).toContain("missing omo-keychain")
  })

  // The store is macOS-only and these cases judge real POSIX modes; NTFS chmod cannot make the folder private.
  describe.skipIf(process.platform === "win32")("OmO's own keychain (#13116)", () => {
    let home = ""
    afterEach(() => rmSync(home, { recursive: true, force: true }))
    const storeLines = (layout: (root: string) => void) => {
      home = mkdtempSync(join(tmpdir(), "omo-doctor-store-"))
      const root = join(home, "Library", "Application Support", "OmO", "credential-keychain")
      layout(root)
      return keychainHelperDoctorLines({
        packageRoot: "/pkg",
        platform: "darwin",
        exists: () => true,
        verify: () => true,
        home,
      }).slice(1)
    }
    const healthy = (
      root: string,
      overrides: { readonly active?: boolean; readonly folder?: number; readonly key?: string } = {},
    ) => {
      mkdirSync(root, { recursive: true, mode: 0o700 })
      chmodSync(root, overrides.folder ?? 0o700)
      writeFileSync(join(root, "omo-credentials.keychain-db"), "", { mode: 0o600 })
      writeFileSync(join(root, "unlock-key"), overrides.key ?? "a".repeat(64), { mode: 0o600 })
      if (overrides.active !== false) writeFileSync(join(root, "active"), "", { mode: 0o600 })
    }

    test("#given no store #when doctor runs #then no store line (the login keychain, unchanged)", () => {
      expect(storeLines(() => {})).toEqual([])
    })

    test.each([
      ["an active, private store", (root: string) => healthy(root), "PASS credential store"],
      ["a store that was never activated", (root: string) => healthy(root, { active: false }), "WARN credential store"],
      ["a group-readable folder", (root: string) => healthy(root, { folder: 0o750 }), "WARN credential store"],
      ["a short key", (root: string) => healthy(root, { key: "abc" }), "WARN credential store"],
    ] as const)("#given %s #when doctor runs #then one store line, never a failure", (_name, layout, prefix) => {
      const lines = storeLines(layout)
      expect(lines).toHaveLength(1)
      expect(lines[0]?.startsWith(prefix)).toBe(true)
    })
  })

  test.each(["linux", "win32"] as const)("#given %s #when doctor runs #then no keychain helper line", (platform) => {
    expect(
      keychainHelperDoctorLines({ packageRoot: "/pkg", platform, exists: () => false, verify: () => false }),
    ).toEqual([])
  })
})
