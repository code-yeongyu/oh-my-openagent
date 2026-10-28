import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveHelperAccess } from "./access"
import { HelperProtocolError, type HelperSpawner } from "./client"
import { pinVerifiedCopy } from "./pin"
import { createSignatureChecker, type SignatureVerdict } from "./signature"

const A = "a".repeat(64)
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A stand-in for the designated-requirement check: a file is "signed" when its bytes say so. The real check is the same
// shape (a pure function of the file's bytes), and it runs through the real per-identity cache.
const contentCheck = () => createSignatureChecker(async path => readFileSync(path, "utf8") === "signed helper")

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "helper-pinned-"))
  roots.push(root)
  const source = join(root, "omo-keychain")
  writeFileSync(source, "signed helper")
  const pins = join(root, "pins")
  const spawned: string[] = []
  const spawn: HelperSpawner = path => {
    spawned.push(path)
    return { pid: 4242, send: () => {}, reply: Promise.resolve('{"missing":true,"present":{"staging":false,"old":false,"oldSlots":[]}}'), close: () => {} }
  }
  return { root, source, pins, spawned, spawn }
}

describe("helper access: pinned copy, re-checked before every spawn (#11586 review)", () => {
  test("#given a verified helper #when it is replaced at its original path after resolution #then later calls still run only the pinned, verified copy", async () => {
    const { source, pins, spawned, spawn } = fixture()
    const verify = contentCheck()
    mkdirSync(pins, { mode: 0o700 })
    const access = await resolveHelperAccess([source], { verify, spawn, pin: (from, check) => pinVerifiedCopy(from, check, pins) })
    if (access.kind !== "ready") throw new Error(`expected ready, got ${access.kind}`)
    expect(access.path.startsWith(pins)).toBe(true)

    writeFileSync(source, "unsigned dev build")
    await access.call({ verb: "read", account: A })
    await access.call({ verb: "write", account: A, value: "v" }, { handOver: async () => {}, restore: async () => {} })

    expect(spawned).toEqual([access.path, access.path])
    expect(spawned).not.toContain(source)
  })

  test("#given the pinned copy itself is changed #when the next call runs #then it is refused and nothing is spawned", async () => {
    const { source, pins, spawned, spawn } = fixture()
    mkdirSync(pins, { mode: 0o700 })
    const access = await resolveHelperAccess([source], { verify: contentCheck(), spawn, pin: (from, check) => pinVerifiedCopy(from, check, pins) })
    if (access.kind !== "ready") throw new Error(`expected ready, got ${access.kind}`)
    await access.call({ verb: "read", account: A })

    chmodSync(access.path, 0o700)
    writeFileSync(access.path, "unsigned dev build")

    await expect(access.call({ verb: "read", account: A })).rejects.toBeInstanceOf(HelperProtocolError)
    expect(spawned).toEqual([access.path])
  })

  test("#given a pinned copy that fails its own check #when resolving #then the access is invalid and the copy is removed", async () => {
    const { source, pins } = fixture()
    mkdirSync(pins, { mode: 0o700 })
    let calls = 0
    const verify = async (): Promise<SignatureVerdict> => (++calls === 1 ? "valid" : "invalid")
    expect(await resolveHelperAccess([source], { verify, pin: (from, check) => pinVerifiedCopy(from, check, pins) })).toEqual({
      kind: "invalid",
      rejected: [source],
    })
    expect(readdirSync(pins)).toEqual([])
  })
})
