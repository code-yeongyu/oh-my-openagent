import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { MemoryBlockCache } from "./cache"
import { removeTree } from "../../../../test-support/remove-tree"

// Contract: a compiled block is a pure function of (revision, inputs, which expiry instants have passed), so a block
// compiled before an `expires` instant is never served after it, from memory or from the persisted store, and a
// caller evaluating at an earlier instant (a pinned session) still gets the earlier bytes.

const TEMPLATE = "template"
const OPTIONS = { agentId: "cache-agent" }
const FIRST = Date.UTC(2026, 9, 27, 6, 33)
const SECOND = Date.UTC(2026, 9, 28)
const tempDirs: string[] = []
const caches: MemoryBlockCache[] = []

afterEach(async () => {
  await Promise.all(caches.splice(0).map((cache) => cache.settled()))
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function createRepo(): Promise<GitMemoryRepo> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-cache-expiry-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "cache-agent" })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nsteady\n" },
      { relativePath: "system/outage.md", content: "---\ndescription: Outage\nexpires: 2026-10-27T06:33Z\n---\noutage body\n" },
      { relativePath: "system/freeze.md", content: "---\ndescription: Freeze\nexpires: 2026-10-28\n---\nfreeze body\n" },
    ],
  })
  return repo
}

const store = () => import("./block-persist")

function cache(persisted: boolean): MemoryBlockCache {
  const created = new MemoryBlockCache(persisted ? { store } : {})
  caches.push(created)
  return created
}

function visible(block: string): string[] {
  return ["outage body", "freeze body"].filter((body) => block.includes(body))
}

describe("MemoryBlockCache expiry", () => {
  const instants: ReadonlyArray<readonly [string, number, readonly string[]]> = [
    ["before both instants", FIRST - 1, ["outage body", "freeze body"]],
    ["at the first instant", FIRST, ["freeze body"]],
    ["between the instants", SECOND - 1, ["freeze body"]],
    ["after both instants", SECOND + 1, []],
  ]

  for (const persisted of [false, true]) {
    const where = persisted ? "the persisted store" : "one process"
    it(`#given blocks compiled across expiry instants through ${where} #when each instant is asked again, out of order #then every answer shows exactly the blocks unexpired at that instant`, async () => {
      // given
      const repo = await createRepo()
      const revision = await repo.head()
      const first = cache(persisted)
      for (const [, asOfMs] of instants) await first.compile(repo, TEMPLATE, OPTIONS, revision, asOfMs)
      await first.settled()

      // when
      const reader = persisted ? cache(true) : first
      const answers = []
      for (const [name, asOfMs, expected] of [...instants].reverse()) {
        answers.push([name, visible(await reader.compile(repo, TEMPLATE, OPTIONS, revision, asOfMs)), expected])
      }

      // then
      for (const [name, actual, expected] of answers) expect({ name, actual }).toEqual({ name, actual: expected })
    })
  }

  it("#given a block compiled at HEAD before an instant #when the clock passes it with no new commit #then the next HEAD compile drops the expired block", async () => {
    // given
    const repo = await createRepo()
    let now = FIRST - 1
    const clocked = new MemoryBlockCache({ now: () => now })
    caches.push(clocked)
    const before = await clocked.compile(repo, TEMPLATE, OPTIONS)

    // when
    now = FIRST
    const after = await clocked.compile(repo, TEMPLATE, OPTIONS)

    // then
    expect(visible(before)).toEqual(["outage body", "freeze body"])
    expect(visible(after)).toEqual(["freeze body"])
    expect(clocked.size).toBe(1)
  })
})
