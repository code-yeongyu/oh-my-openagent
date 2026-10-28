import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveHelperAccess } from "./access"
import { pinVerifiedCopy, sweepDeadPinDirs } from "./pin"
import { processSignatureChecker } from "./signature"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "helper-pin-"))
  roots.push(root)
  return root
}
const alwaysValid = async () => "valid" as const

describe("pinned helper copies (#11586 review LOWs)", () => {
  test("#given the same unchanged source #when it is pinned twice #then one copy is reused; a changed source gets a new one", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    const pins = join(root, "pins")
    mkdirSync(pins, { mode: 0o700 })
    writeFileSync(source, "signed helper")
    const first = await pinVerifiedCopy(source, alwaysValid, pins)
    const second = await pinVerifiedCopy(source, alwaysValid, pins)
    expect(first.kind).toBe("pinned")
    expect(second).toEqual(first)
    expect(readdirSync(pins)).toHaveLength(1)

    writeFileSync(source, "signed helper, new build")
    const third = await pinVerifiedCopy(source, alwaysValid, pins)
    expect(third.kind === "pinned" && first.kind === "pinned" && third.path !== first.path).toBe(true)
  })

  test("#given a pin directory that cannot be written #when pinning #then the copy failure is a typed unavailable", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    const pins = join(root, "pins")
    mkdirSync(pins, { mode: 0o500 })
    writeFileSync(source, "signed helper")
    const result = await pinVerifiedCopy(source, alwaysValid, pins)
    chmodSync(pins, 0o700)
    expect(result.kind).toBe("unavailable")
  })

  test("#given a reused pin that no longer verifies #when pinning again #then a fresh copy replaces it", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    const pins = join(root, "pins")
    mkdirSync(pins, { mode: 0o700 })
    writeFileSync(source, "signed helper")
    const first = await pinVerifiedCopy(source, alwaysValid, pins)
    if (first.kind !== "pinned") throw new Error(`expected pinned, got ${first.kind}`)
    const second = await pinVerifiedCopy(source, async path => (path === first.path ? "invalid" : "valid"), pins)
    expect(second.kind === "pinned" && second.path !== first.path).toBe(true)
  })

  test("#given TMPDIR does not exist #when pinning into the process directory #then unavailable, and a later attempt succeeds", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    writeFileSync(source, "signed helper, tmpdir case")
    const previous = process.env.TMPDIR
    process.env.TMPDIR = join(root, "missing")
    try {
      expect((await pinVerifiedCopy(source, alwaysValid)).kind).toBe("unavailable")
      mkdirSync(join(root, "missing"))
      expect((await pinVerifiedCopy(source, alwaysValid)).kind).toBe("pinned")
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
    }
  })

  test("#given a source that vanishes before the copy #when resolving #then a typed unavailable result, never a rejection", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    writeFileSync(source, "signed helper")
    const access = await resolveHelperAccess([source], {
      verify: alwaysValid,
      pin: (from, verify) => {
        rmSync(from)
        return pinVerifiedCopy(from, verify, root)
      },
    })
    expect(access.kind).toBe("unavailable")
  })

  test("#given pin directories of a dead process, of a live one and an unrelated directory #when swept #then only the dead owner's goes", async () => {
    const root = tempRoot()
    const dead = Bun.spawn(["true"])
    await dead.exited
    for (const name of [`omo-keychain-${dead.pid}-aaaaaa`, `omo-keychain-${process.pid}-bbbbbb`, `omo-keychain-1-cccccc`, "omo-keychain-notapid"]) {
      mkdirSync(join(root, name))
    }
    expect(sweepDeadPinDirs(root)).toEqual([`omo-keychain-${dead.pid}-aaaaaa`])
    expect(readdirSync(root).sort()).toEqual([`omo-keychain-${process.pid}-bbbbbb`, "omo-keychain-1-cccccc", "omo-keychain-notapid"].sort())
  })
})

describe.skipIf(process.platform !== "darwin")("the per-process signature checker (#11586 review LOW 1)", () => {
  test("#given two calls #when the checker is requested #then it is one shared instance", () => {
    expect(processSignatureChecker()).toBe(processSignatureChecker())
  })

})
