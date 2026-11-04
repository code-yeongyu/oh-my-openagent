/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildKeychainHelper,
  KEYCHAIN_HELPER_IDENTIFIER,
  KEYCHAIN_HELPER_REQUIREMENT,
  KEYCHAIN_HELPER_TEAM,
} from "../packages/omo-native/keychain-helper/build"
import { designatedRequirement, keychainHelperFailures, type ToolResult, type ToolRunner } from "./keychain-helper-release"

const FILE = "/release/omo-keychain"

type Signed = {
  readonly archs: string
  readonly strictStatus: number
  readonly requirement: string
  readonly identifier: string
  readonly team: string
  readonly flags: string
  readonly entitlements: string
}

const DEVELOPER_ID: Signed = {
  archs: "x86_64 arm64",
  strictStatus: 0,
  requirement: KEYCHAIN_HELPER_REQUIREMENT,
  identifier: KEYCHAIN_HELPER_IDENTIFIER,
  team: KEYCHAIN_HELPER_TEAM,
  flags: "0x10000(runtime)",
  entitlements: "",
}

function codesignFake(signed: Signed): ToolRunner {
  const ok = (stdout: string, stderr = ""): ToolResult => ({ status: 0, stdout, stderr })
  return (command, args) => {
    if (command === "lipo") return ok(`${signed.archs}\n`)
    if (args.includes("--verify")) return { status: signed.strictStatus, stdout: "", stderr: signed.strictStatus === 0 ? "" : `${FILE}: test-requirement failed\n` }
    if (args.includes("-r-")) return ok(`designated => ${signed.requirement}\n`, `Executable=${FILE}\n`)
    if (args.includes("--entitlements")) return ok(signed.entitlements, `Executable=${FILE}\n`)
    return ok("", [
      `Executable=${FILE}`,
      `Identifier=${signed.identifier}`,
      "Format=Mach-O universal (x86_64 arm64)",
      `CodeDirectory v=20500 size=900 flags=${signed.flags} hashes=20+7 location=embedded`,
      `TeamIdentifier=${signed.team}`,
      "",
    ].join("\n"))
  }
}

describe("keychain helper release gate", () => {
  test("parses the designated requirement line codesign prints", () => {
    expect(designatedRequirement(`Executable=${FILE}\ndesignated => ${KEYCHAIN_HELPER_REQUIREMENT}\n`)).toBe(KEYCHAIN_HELPER_REQUIREMENT)
    expect(designatedRequirement(`Executable=${FILE}\n`)).toBeUndefined()
  })

  test("reads codesign's annotated requirement as the same requirement", () => {
    const annotated = KEYCHAIN_HELPER_REQUIREMENT.replace("[field.1.2.840.113635.100.6.2.6]", "[field.1.2.840.113635.100.6.2.6] /* exists */").replace(
      "[field.1.2.840.113635.100.6.1.13]",
      "[field.1.2.840.113635.100.6.1.13] /* exists */",
    )
    expect(annotated).not.toBe(KEYCHAIN_HELPER_REQUIREMENT)
    expect(designatedRequirement(`Executable=${FILE}\ndesignated => ${annotated}\n`)).toBe(KEYCHAIN_HELPER_REQUIREMENT)
    expect(keychainHelperFailures(FILE, codesignFake({ ...DEVELOPER_ID, requirement: annotated }), 0o100755)).toEqual([])
  })

  test("accepts the Developer ID helper the contract describes", () => {
    expect(keychainHelperFailures(FILE, codesignFake(DEVELOPER_ID), 0o100755)).toEqual([])
  })

  const violations: ReadonlyArray<readonly [string, Partial<Signed> | null, RegExp]> = [
    ["a helper without u+x", null, /not executable by its owner/],
    ["a single-architecture build", { archs: "arm64" }, /lacks the x86_64 slice/],
    ["a strict verification failure", { strictStatus: 3 }, /codesign --verify --strict/],
    ["a re-sign that renamed the identifier", { requirement: KEYCHAIN_HELPER_REQUIREMENT.replace(KEYCHAIN_HELPER_IDENTIFIER, "omo-keychain") }, /designated requirement differs/],
    ["an ad-hoc signature", { requirement: 'cdhash H"0000"', team: "not set" }, /TeamIdentifier=not set/],
    ["another team", { team: "ABCDE12345" }, /TeamIdentifier=ABCDE12345, expected 523JNR86LZ/],
    ["a missing hardened runtime", { flags: "0x0(none)" }, /lacks the hardened runtime/],
    ["entitlements", { entitlements: "<?xml version=\"1.0\"?><plist><dict/></plist>" }, /carries entitlements/],
  ]
  for (const [label, change, message] of violations) {
    test(`refuses ${label}`, () => {
      const failures = keychainHelperFailures(FILE, codesignFake({ ...DEVELOPER_ID, ...change }), change === null ? 0o100644 : 0o100755)
      expect(failures.join("\n")).toMatch(message)
    })
  }

  test.skipIf(process.platform !== "darwin")("refuses a real linker-signed build of the helper through codesign itself", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-keychain-gate-"))
    try {
      const output = join(root, "omo-keychain")
      await buildKeychainHelper({ output, flavor: "release" })
      const failures = keychainHelperFailures(output)
      expect(failures.some((failure) => failure.startsWith("designated requirement differs"))).toBe(true)
      expect(failures.some((failure) => failure.startsWith("TeamIdentifier="))).toBe(true)
      expect(failures.some((failure) => /lacks the (arm64|x86_64) slice/.test(failure))).toBe(false)
      expect(failures.some((failure) => failure.includes("not executable"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
