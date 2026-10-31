import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KEYCHAIN_HELPER_REQUIREMENT as BUILT_REQUIREMENT } from "../../../../../omo-native/keychain-helper/build"
import { createSignatureChecker, KEYCHAIN_HELPER_REQUIREMENT, signatureBackend } from "./signature"

describe("keychain helper signature check (#11262 design 1, Checking the helper)", () => {
  test("#given the requirement the client checks #when compared with the one the helper is built and signed for #then they are identical", () => {
    expect(KEYCHAIN_HELPER_REQUIREMENT).toBe(BUILT_REQUIREMENT)
  })

  test("#given an unchanged file #when checked twice #then the framework is asked once; a rewritten file is asked again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    const path = join(dir, "omo-keychain")
    writeFileSync(path, "one")
    const asked: string[] = []
    const check = createSignatureChecker(async (file, requirement) => {
      asked.push(`${file} ${requirement === KEYCHAIN_HELPER_REQUIREMENT}`)
      return true
    })
    expect(await check(path)).toBe("valid")
    expect(await check(path)).toBe("valid")
    expect(asked).toHaveLength(1)
    writeFileSync(path, "two, longer")
    utimesSync(path, new Date(), new Date(Date.now() + 5_000))
    expect(await check(path)).toBe("valid")
    expect(asked).toEqual([`${path} true`, `${path} true`])
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given a same-size rewrite with its mtime put back #when checked again #then ctime catches it and the framework is asked again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    const path = join(dir, "omo-keychain")
    writeFileSync(path, "aaaa")
    const { atime, mtime } = statSync(path)
    let asked = 0
    const check = createSignatureChecker(async () => ++asked > 0)
    expect(await check(path)).toBe("valid")
    writeFileSync(path, "bbbb")
    utimesSync(path, atime, mtime)
    expect(await check(path)).toBe("valid")
    expect(asked).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given the file changes while it is being checked #when the check finishes #then the answer is invalid and nothing is cached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    const path = join(dir, "omo-keychain")
    writeFileSync(path, "signed")
    let asked = 0
    const check = createSignatureChecker(async file => {
      asked++
      if (asked === 1) writeFileSync(file, "swapped during the check")
      return true
    })
    expect(await check(path)).toBe("invalid")
    expect(await check(path)).toBe("valid")
    expect(asked).toBe(2)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given a missing path or a directory #when checked #then it is missing and the framework is never asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    let asked = 0
    const check = createSignatureChecker(async () => ++asked > 0)
    expect(await check(join(dir, "absent"))).toBe("missing")
    expect(await check(dir)).toBe("missing")
    expect(asked).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given a file failing the requirement #when checked #then it is invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    const path = join(dir, "omo-keychain")
    writeFileSync(path, "tampered")
    expect(await createSignatureChecker(async () => false)(path)).toBe("invalid")
    rmSync(dir, { recursive: true, force: true })
  })

  test.skipIf(process.platform !== "darwin")("#given an unsigned binary #when the real framework checks it #then it fails the Developer ID requirement", async () => {
    const dir = mkdtempSync(join(tmpdir(), "helper-signature-"))
    const path = join(dir, "true-copy")
    writeFileSync(path, await Bun.file("/usr/bin/true").bytes())
    expect(await signatureBackend()).toBe("ffi")
    expect(await createSignatureChecker()(path)).toBe("invalid")
    expect(await createSignatureChecker()("/usr/bin/true")).toBe("invalid")
    rmSync(dir, { recursive: true, force: true })
  })
})
