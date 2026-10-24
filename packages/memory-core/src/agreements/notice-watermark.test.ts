import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { consumeAgreementsNoticeDelta } from "./notice-watermark"
import { AGREEMENTS_PATH } from "./types"
import { observeWatermarkPublication, withWatermarkReadFault } from "../concurrency/watermark-publication.test-support"

const AUTHOR = { agentId: "agent-one", authorName: "Facts Extractor" }
const line = (n: number, status: string) =>
  `- [global] Never filter the monitor <!-- id: 3f9a1c0b2e; by: agent; n: ${n}; status: ${status} -->`
const roots: string[] = []

setDefaultTimeout(20_000)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "agreements-notice-")))
  roots.push(root)
  const repo = new GitMemoryRepo({ dir: join(root, "memory"), agentId: AUTHOR.agentId })
  await repo.init()
  await mkdir(join(repo.dir, "system"), { recursive: true })
  const options = { noticesDir: join(root, "notices"), locksDir: join(root, "locks") }
  const commitLedger = async (body: string) => {
    await writeFile(join(repo.dir, AGREEMENTS_PATH), `---\ndescription: Agreements\n---\n\n${body}\n`)
    await repo.commitWrite([AGREEMENTS_PATH], "ledger", AUTHOR)
  }
  return { repo, options, commitLedger }
}

describe("needs-human notice watermark (exactly-once contract)", () => {
  it.each([undefined, "{", '{"version":2}'])(
    "#given no flagged items and watermark %j #when consumed #then the locked path establishes valid empty state",
    async (initial) => {
      const { repo, options, commitLedger } = await fixture()
      await commitLedger(line(0, "active"))
      const target = join(options.noticesDir, "agreements-flagged.json")
      if (initial !== undefined) {
        await mkdir(options.noticesDir, { recursive: true })
        await writeFile(target, initial, "utf8")
      }
      expect(await consumeAgreementsNoticeDelta(repo, options)).toEqual([])
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1, announced: [] })
    },
  )

  it("#given staged publication #when the writer pauses after truncation and partial writes #then readers see old or new state and each writer owns a unique temporary", async () => {
    const { repo, options, commitLedger } = await fixture()
    await commitLedger(line(3, "needs-human"))
    await consumeAgreementsNoticeDelta(repo, options)
    const target = join(options.noticesDir, "agreements-flagged.json")
    const temporaries: string[] = []
    for (const status of ["active", "needs-human"]) {
      await commitLedger(line(3, status))
      temporaries.push(await observeWatermarkPublication(target, () =>
        consumeAgreementsNoticeDelta(repo, options),
      ))
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
        version: 1, announced: status === "active" ? [] : ["3f9a1c0b2e"],
      })
    }
    expect(new Set(temporaries).size).toBe(2)
  })

  it.each(["malformed", "invalid-shape", "missing", "unreadable"] as const)(
    "#given a %s unlocked read #when acknowledged #then the locked reread clears the watermark and permits a later reflag",
    async (fault) => {
      const { repo, options, commitLedger } = await fixture()
      await commitLedger(line(3, "needs-human"))
      await consumeAgreementsNoticeDelta(repo, options)
      await commitLedger(line(0, "active"))
      const target = join(options.noticesDir, "agreements-flagged.json")
      await withWatermarkReadFault(target, fault, async () => {
        expect(await consumeAgreementsNoticeDelta(repo, options)).toEqual([])
      })
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1, announced: [] })
      await commitLedger(line(3, "needs-human"))
      expect((await consumeAgreementsNoticeDelta(repo, options)).map((item) => item.id)).toEqual(["3f9a1c0b2e"])
    },
  )

  it("#given an item that just crossed the threshold #when consumed concurrently and again #then it is announced once", async () => {
    // given
    const { repo, options, commitLedger } = await fixture()
    await commitLedger(line(3, "needs-human"))

    // when
    const concurrent = await Promise.all([
      consumeAgreementsNoticeDelta(repo, options),
      consumeAgreementsNoticeDelta(repo, options),
    ])
    const second = await consumeAgreementsNoticeDelta(repo, options)

    // then
    expect(concurrent.flat().map((item) => item.id)).toEqual(["3f9a1c0b2e"])
    expect(second).toEqual([])
  })

  it("#given an announced item the person acknowledged #when it is flagged again #then it is announced again", async () => {
    // given
    const { repo, options, commitLedger } = await fixture()
    await commitLedger(line(3, "needs-human"))
    await consumeAgreementsNoticeDelta(repo, options)
    await commitLedger(line(0, "active"))
    await consumeAgreementsNoticeDelta(repo, options)

    // when
    await commitLedger(line(3, "needs-human"))
    const again = await consumeAgreementsNoticeDelta(repo, options)

    // then
    expect(again.map((item) => item.n)).toEqual([3])
  })
})
