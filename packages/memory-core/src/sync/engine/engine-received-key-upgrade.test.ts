import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { CycleRecord, EngineState, IncomingRecord, RenderRecord } from "./journal"
import { besideRoot, sealedItems } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const REFUSED = ["../x.md", "sub/../../y.md", "../old.md", ".git/hooks/post-commit"]
const CYCLE_ID = "0123456789abcdef"

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

async function readKeys(path: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  return Array.isArray(parsed) ? parsed.map(String) : Object.keys(parsed ?? {})
}

test(
  "a journal and item store poisoned by an older build recover on the first cycle and keep no refused key",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a", undefined, { realStore: true })
    devices.push(a)
    await a.write("seed.md", "seed\n")
    await a.engine.runCycle()
    await a.write("ok2.md", "---\ndescription: second\n---\nsecond\n")
    await a.engine.runCycle()
    const [entry1, entry2] = server.entries
    if (entry1 === undefined || entry2 === undefined) throw new Error("a did not publish two batches")
    const ok2 = sealedItems(server, 2).find((i) => i.key === "ok2.md")
    if (ok2 === undefined) throw new Error("no ok2.md item")

    const b = await makeDevice(server, "b", undefined, { realStore: true })
    devices.push(b)
    const sync = join(b.repo.gitDir, "omo-sync")
    const beside = await besideRoot(b)
    const cycle: CycleRecord = {
      id: CYCLE_ID,
      stage: "merged",
      first: 1,
      last: 1,
      batches: [entry1],
      keys: ["../x.md", ".git/hooks/post-commit"],
      treeId: null,
    }
    const state: EngineState = {
      applied: 0,
      eventHead: 0,
      refused: 0,
      rejectedItems: 0,
      held: null,
      owed: [],
      cycle,
      paused: null,
      lastSyncedAt: null,
      updatedWhileOffline: 0,
      peer: null,
    }
    await writeJsonFile(join(sync, "state.json"), state)
    const incoming1: IncomingRecord = {
      entry: entry1,
      stage: "verified",
      items: [{ key: "../x.md", ops: ok2.ops }],
      snapshot: false,
    }
    const incoming2: IncomingRecord = {
      entry: entry2,
      stage: "verified",
      items: [{ key: "sub/../../y.md", ops: ok2.ops }, ok2],
      snapshot: false,
    }
    await writeJsonFile(join(sync, "incoming", "000000000001.json"), incoming1)
    await writeJsonFile(join(sync, "incoming", "000000000002.json"), incoming2)
    const landed: RenderRecord = { seq: 1, key: "../x.md", frontier: "", hash: "h", text: "poison\n" }
    await writeJsonFile(join(sync, "renders", CYCLE_ID, "00000001.json"), landed)
    await writeJsonFile(join(sync, "crdt", "docs.json"), ["../old.md", ".git/hooks/post-commit"])
    await writeJsonFile(join(sync, "crdt", "baselines.json"), { "../old.md": { text: null, frontier: [] } })

    const report = await b.engine.runCycle()
    expect(report).toMatchObject({ applied: 1, refused: 0 })
    expect(await b.engine.state()).toMatchObject({ applied: 2, cycle: null, paused: null })
    expect(await b.read("ok2.md")).toBe(await a.read("ok2.md"))
    expect(await besideRoot(b)).toEqual(beside)
    expect(await b.read(".git/hooks/post-commit")).toBeNull()
    for (const file of ["docs.json", "baselines.json"]) {
      const keys = await readKeys(join(sync, "crdt", file))
      for (const refused of REFUSED) expect(keys).not.toContain(refused)
    }
    expect(await b.renderJournals()).toEqual([])
  },
  GIT_TEST_TIMEOUT,
)
