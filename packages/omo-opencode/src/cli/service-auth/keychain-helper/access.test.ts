import { describe, expect, test } from "bun:test"
import { resolveHelperAccess } from "./access"
import type { HelperSpawner } from "./client"
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
