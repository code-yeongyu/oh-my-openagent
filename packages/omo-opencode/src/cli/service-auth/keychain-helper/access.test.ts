import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveHelperAccess } from "./access"
import { HelperProtocolError, type HelperSpawner } from "./client"
import { pinVerifiedCopy } from "./pin"
import type { SignatureVerdict } from "./signature"

const A = "a".repeat(64)

describe("helper access: verified fall-through (#11262 addendum row 10, ruling 2026-10-28)", () => {
  test("#given an invalid copy first and a valid copy later #when the store calls the helper #then only the valid copy is spawned", async () => {
    const verdicts: Record<string, SignatureVerdict> = { "/first/omo-keychain": "invalid", "/later/omo-keychain": "valid" }
    const spawned: string[] = []
    const spawn: HelperSpawner = path => {
      spawned.push(path)
      return { pid: 4242, send: () => {}, reply: Promise.resolve('{"missing":true,"present":{"staging":false,"old":false,"oldSlots":[]}}'), close: () => {} }
    }

    const pinnedFrom: string[] = []
    const pin = async (source: string) => {
      pinnedFrom.push(source)
      return { kind: "pinned" as const, path: `/pinned${source}` }
    }
    verdicts["/pinned/later/omo-keychain"] = "valid"
    const access = await resolveHelperAccess(["/first/omo-keychain", "/later/omo-keychain"], { verify: async path => verdicts[path] ?? "missing", spawn, pin })
    if (access.kind !== "ready") throw new Error(`expected a ready helper, got ${access.kind}`)
    await access.call({ verb: "read", account: A })

    expect(pinnedFrom).toEqual(["/later/omo-keychain"])
    expect(spawned).toEqual(["/pinned/later/omo-keychain"])
  })
})

const throwRoots: string[] = []
afterEach(() => {
  for (const root of throwRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// One signature checker that throws on its Nth call and answers valid otherwise; verify call order within one store
// session is: locate (1), fresh pin copy (2); a second resolve is locate (3), cached-pin re-check (4); a call is pre-spawn.
function throwingOnCall(n: number) {
  let calls = 0
  return async (_path: string): Promise<SignatureVerdict> => {
    calls += 1
    if (calls === n) throw new Error("checker crashed")
    return "valid"
  }
}

function helperOnDisk() {
  const root = mkdtempSync(join(tmpdir(), "helper-throw-"))
  throwRoots.push(root)
  const source = join(root, "omo-keychain")
  const pins = join(root, "pins")
  mkdirSync(pins, { mode: 0o700 })
  writeFileSync(source, `signed helper ${root}`)
  return { source, pins }
}

const neverSpawn: HelperSpawner = () => {
  throw new Error("a helper was spawned")
}

describe("a signature checker that throws, at every call site (#11586 and #11613 review LOWs, by class)", () => {
  test.each([
    { site: "locate", resolves: 1, throwOn: 1 },
    { site: "fresh pin copy", resolves: 1, throwOn: 2 },
    { site: "cached pin re-check", resolves: 2, throwOn: 4 },
  ])("#given the checker throws at $site #when the store resolves the helper #then a typed unavailable, no copy kept, and the next resolve works", async ({ resolves, throwOn }) => {
    const { source, pins } = helperOnDisk()
    const verify = throwingOnCall(throwOn)
    const resolve = () => resolveHelperAccess([source], { verify, spawn: neverSpawn, pin: (from, check) => pinVerifiedCopy(from, check, pins) })
    for (let attempt = 1; attempt < resolves; attempt++) expect((await resolve()).kind).toBe("ready")
    expect(await resolve()).toEqual({ kind: "unavailable", reason: "checker crashed" })
    expect(readdirSync(pins)).toEqual([])
    expect((await resolve()).kind).toBe("ready")
  })

  test("#given the checker throws before a spawn #when the store calls the helper #then a typed HelperProtocolError and nothing is spawned", async () => {
    const { source, pins } = helperOnDisk()
    const access = await resolveHelperAccess([source], { verify: throwingOnCall(3), spawn: neverSpawn, pin: (from, check) => pinVerifiedCopy(from, check, pins) })
    if (access.kind !== "ready") throw new Error(`expected ready, got ${access.kind}`)
    await expect(access.call({ verb: "read", account: A })).rejects.toBeInstanceOf(HelperProtocolError)
  })
})
