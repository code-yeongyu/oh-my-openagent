import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { IDENTITY_RECORD_FILENAME, markIdentityMerged, readIdentityRecord, recordIdentityBind } from "./record"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function identityRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-identity-record-"))
  roots.push(root)
  const identity = join(root, "agents", "project-1234abcd")
  await mkdir(identity, { recursive: true })
  return identity
}

describe("identity record (#10070)", () => {
  test("#given a first bind #when it is recorded #then identity.json holds the id, kind, mode, source, one spelling and both timestamps, mode 0600", async () => {
    const root = await identityRoot()

    await recordIdentityBind(root, { id: "project-1234abcd", kind: "auto", mode: "path", source: "/work/project", spelling: "/work/project" }, 1000)

    expect(await readIdentityRecord(root)).toEqual({
      version: 1,
      id: "project-1234abcd",
      kind: "auto",
      mode: "path",
      source: "/work/project",
      spellings: ["/work/project"],
      firstBoundAt: 1000,
      lastBoundAt: 1000,
    })
    expect((await stat(join(root, IDENTITY_RECORD_FILENAME))).mode & 0o777).toBe(0o600)
  })

  test("#given an existing record #when a later bind arrives from another spelling and mode #then spellings accumulate once each, firstBoundAt stays and the latest mode and source win", async () => {
    const root = await identityRoot()
    await recordIdentityBind(root, { id: "project-1234abcd", kind: "auto", mode: "path", source: "/work/project", spelling: "/work/project" }, 1000)

    await recordIdentityBind(root, { id: "project-1234abcd", kind: "auto", mode: "git", source: "/work/project", spelling: "/work/project-wt" }, 2000)
    await recordIdentityBind(root, { id: "project-1234abcd", kind: "auto", mode: "git", source: "/work/project", spelling: "/work/project" }, 3000)

    expect(await readIdentityRecord(root)).toMatchObject({
      mode: "git",
      spellings: ["/work/project", "/work/project-wt"],
      firstBoundAt: 1000,
      lastBoundAt: 3000,
    })
  })

  test("#given an unreadable or malformed record #when a bind is recorded #then it is replaced by a fresh record instead of failing the bind", async () => {
    const root = await identityRoot()
    await recordIdentityBind(root, { id: "project-1234abcd", kind: "explicit", mode: "path", source: "/w", spelling: "/w" }, 1000)
    await writeFile(join(root, IDENTITY_RECORD_FILENAME), "{not json")

    await recordIdentityBind(root, { id: "project-1234abcd", kind: "explicit", mode: "path", source: "/w", spelling: "/w" }, 5000)

    expect(await readIdentityRecord(root)).toMatchObject({ kind: "explicit", firstBoundAt: 5000, lastBoundAt: 5000 })
    expect(JSON.parse(await readFile(join(root, IDENTITY_RECORD_FILENAME), "utf8")).version).toBe(1)
  })

  test("#given binds from many folders and a merge mark landing together #when they finish #then no spelling and no merge marker is lost (#12974 review r5)", async () => {
    const root = await identityRoot()
    const spellings = Array.from({ length: 12 }, (_, index) => `/work/thread-${index}`)

    await Promise.all([
      ...spellings.map((spelling, index) => recordIdentityBind(root, { id: "project-aaaa1111", kind: "auto", mode: "git", source: "/work/project", spelling }, 100 + index)),
      markIdentityMerged(root, "project-aaaa1111", "project-target", "abc123", 99),
    ])

    const record = await readIdentityRecord(root)
    expect([...(record?.spellings ?? [])].sort()).toEqual([...spellings].sort())
    expect(record).toMatchObject({ mergedInto: "project-target", mergedHead: "abc123" })
  })

  test("#given an identity whose store does not exist yet #when a bind is recorded #then nothing is written and no directory is created (bind stays write-free, #12974 train-3)", async () => {
    const parent = await mkdtemp(join(tmpdir(), "omo-identity-record-"))
    roots.push(parent)
    const memoryHome = join(parent, "memory")
    const root = join(memoryHome, "agents", "project-1234abcd")

    const record = await recordIdentityBind(root, { id: "project-1234abcd", kind: "auto", mode: "git", source: "/w/p", spelling: "/w/p" }, 1)

    expect(record).toBeUndefined()
    expect(existsSync(memoryHome)).toBe(false)
  })

  test("#given no record #when it is read #then the answer is undefined", async () => {
    expect(await readIdentityRecord(await identityRoot())).toBeUndefined()
  })
})
