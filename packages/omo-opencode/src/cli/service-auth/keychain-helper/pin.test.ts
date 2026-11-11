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
// POSIX directory modes and TMPDIR are what these cases exercise; Windows has neither (a read-only directory stays
// writable and os.tmpdir() reads TEMP), and the pinned keychain helper only ever runs on macOS.
const posixPermissions = process.platform !== "win32"
const exitedPid = async () => {
  const child = Bun.spawn([process.execPath, "-e", ""])
  await child.exited
  return child.pid
}

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

  test.skipIf(!posixPermissions)(
    "#given a pin directory that cannot be written #when pinning #then the copy failure is a typed unavailable",
    async () => {
      const root = tempRoot()
      const source = join(root, "omo-keychain")
      const pins = join(root, "pins")
      mkdirSync(pins, { mode: 0o500 })
      writeFileSync(source, "signed helper")
      const result = await pinVerifiedCopy(source, alwaysValid, pins)
      chmodSync(pins, 0o700)
      expect(result.kind).toBe("unavailable")
    },
  )

  test("#given a reused pin that no longer verifies #when pinning again #then a fresh copy replaces it", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    const pins = join(root, "pins")
    mkdirSync(pins, { mode: 0o700 })
    writeFileSync(source, "signed helper")
    const first = await pinVerifiedCopy(source, alwaysValid, pins)
    if (first.kind !== "pinned") throw new Error(`expected pinned, got ${first.kind}`)
    const second = await pinVerifiedCopy(source, async (path) => (path === first.path ? "invalid" : "valid"), pins)
    expect(second.kind === "pinned" && second.path !== first.path).toBe(true)
  })

  test.skipIf(!posixPermissions)(
    "#given TMPDIR does not exist #when pinning into the process directory #then unavailable, and a later attempt succeeds",
    async () => {
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
    },
  )

  test("#given a signature check that throws #when pinning #then a typed unavailable, no copy left behind, and the next attempt runs again", async () => {
    const root = tempRoot()
    const source = join(root, "omo-keychain")
    const pins = join(root, "pins")
    mkdirSync(pins, { mode: 0o700 })
    writeFileSync(source, "signed helper, throwing checker case")
    const throwing = async (): Promise<"valid"> => {
      throw new Error("checker crashed")
    }
    expect(await pinVerifiedCopy(source, throwing, pins)).toEqual({ kind: "unavailable", reason: "checker crashed" })
    expect(readdirSync(pins)).toEqual([])
    expect((await pinVerifiedCopy(source, alwaysValid, pins)).kind).toBe("pinned")
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
    const dead = await exitedPid()
    // pid 1 is a live process this user does not own (EPERM) on POSIX; Windows has no such pid.
    const foreignLive = posixPermissions ? ["omo-keychain-1-cccccc"] : []
    for (const name of [
      `omo-keychain-${dead}-aaaaaa`,
      `omo-keychain-${process.pid}-bbbbbb`,
      ...foreignLive,
      "omo-keychain-notapid",
    ]) {
      mkdirSync(join(root, name))
    }
    expect(sweepDeadPinDirs(root)).toEqual([`omo-keychain-${dead}-aaaaaa`])
    expect(readdirSync(root).sort()).toEqual(
      [`omo-keychain-${process.pid}-bbbbbb`, ...foreignLive, "omo-keychain-notapid"].sort(),
    )
  })

  test.skipIf(!posixPermissions || process.getuid?.() === 0)(
    "#given a dead owner's pin directory this user cannot delete #when swept #then it is skipped, the sweep goes on, and nothing throws",
    async () => {
      const root = tempRoot()
      const dead = { pid: await exitedPid() }
      const stuck = join(root, `omo-keychain-${dead.pid}-stuck00`)
      mkdirSync(stuck)
      writeFileSync(join(stuck, "omo-keychain"), "helper copy")
      chmodSync(stuck, 0o500)
      mkdirSync(join(root, `omo-keychain-${dead.pid}-gone00`))
      try {
        expect(sweepDeadPinDirs(root)).toEqual([`omo-keychain-${dead.pid}-gone00`])
        expect(readdirSync(root)).toEqual([`omo-keychain-${dead.pid}-stuck00`])
      } finally {
        chmodSync(stuck, 0o700)
      }
    },
  )
})

describe.skipIf(process.platform !== "darwin")("the per-process signature checker (#11586 review LOW 1)", () => {
  test("#given two calls #when the checker is requested #then it is one shared instance", () => {
    expect(processSignatureChecker()).toBe(processSignatureChecker())
  })
})
