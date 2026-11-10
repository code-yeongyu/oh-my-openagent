import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, markIdentityMerged, recordIdentityBind } from "@oh-my-opencode/memory-core"
import { checkMemoryFragmentation } from "./doctor-checks"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true })))
})

describe("doctor memory fragmentation (#10070)", () => {
  test("#given two old stores whose directories map to this identity, one already merged #when checked #then it warns with the unmerged count and the dry-run command", async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-doctor-frag-"))
    roots.push(root)
    const target = buildIdentityPaths(root, "project-aaaa1111")
    await recordIdentityBind(buildIdentityPaths(root, "thread-1-bbbb2222").root, { id: "thread-1-bbbb2222", kind: "auto", mode: "path", source: "/w/thread-1", spelling: "/w/thread-1" }, 1)
    await recordIdentityBind(buildIdentityPaths(root, "thread-2-cccc3333").root, { id: "thread-2-cccc3333", kind: "auto", mode: "path", source: "/w/thread-2", spelling: "/w/thread-2" }, 1)
    await markIdentityMerged(buildIdentityPaths(root, "thread-2-cccc3333").root, "thread-2-cccc3333", "project-aaaa1111", "abc", 2)

    const check = await checkMemoryFragmentation(target, () => "project-aaaa1111")

    expect(check).toEqual({
      name: "memory-fragmentation",
      level: "warn",
      detail: "1 older memory store maps to this repository (thread-1-bbbb2222); /memory-merge shows what it would bring in, /memory-merge --apply merges it",
    })
  })

  test("#given no other store maps here #when checked #then it is ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "omo-doctor-frag-"))
    roots.push(root)

    expect((await checkMemoryFragmentation(buildIdentityPaths(root, "project-aaaa1111"), () => "elsewhere")).level).toBe("ok")
  })
})
