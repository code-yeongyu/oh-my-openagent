import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { consumeAgreementsNoticeDelta } from "./notice-watermark"
import { AGREEMENTS_PATH } from "./types"

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
  it("#given an item that just crossed the threshold #when consumed twice #then it is announced once", async () => {
    // given
    const { repo, options, commitLedger } = await fixture()
    await commitLedger(line(3, "needs-human"))

    // when
    const first = await consumeAgreementsNoticeDelta(repo, options)
    const second = await consumeAgreementsNoticeDelta(repo, options)

    // then
    expect(first.map((item) => item.id)).toEqual(["3f9a1c0b2e"])
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
