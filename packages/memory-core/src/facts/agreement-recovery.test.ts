import { expect, onTestFinished, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { agreementId } from "../agreements/format"
import { agreementItemsOf } from "../agreements/ledger-file"
import { AGREEMENTS_PATH } from "../agreements/types"
import { GitMemoryRepo } from "../git"
import { applyFactsBatch, type FactsBatch } from "./extraction"
import { factsRecordsHash, type FactsApplyRecovery } from "./mutation-plan"
import { applyFactsRecovery } from "./recovery"

const TEXT = "Use the fixture convention"
const ID = agreementId(TEXT)
const AUTHOR = { agentId: "fixture", authorName: "Fixture" }
const ledger = (n: number, date: string) => `---\ndescription: Agreements\n---\n\n- [global] ${TEXT} <!-- id: ${ID}; by: agent; n: ${n}; since: 2026-10-01; last: ${date}; status: active -->\n`

async function fixture(date: string, partial: boolean) {
  const root = await mkdtemp(join(tmpdir(), "agreement-recovery-"))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const repo = new GitMemoryRepo({ dir: root, agentId: "fixture" })
  await repo.init({ seedFiles: [{ relativePath: AGREEMENTS_PATH, content: ledger(1, "2026-10-01") }] })
  const head = await repo.head()
  if (head === null) throw new Error("missing HEAD")
  const batch: FactsBatch = {
    batchId: randomUUID(), records: [],
    agreements: [{ action: "reaffirm", id: ID, date }],
  }
  const pre = await repo.pathState.capture(AGREEMENTS_PATH)
  const oldPost = ledger(2, date)
  const recovery: FactsApplyRecovery = {
    version: 1, batchId: batch.batchId, headBeforeApply: head, recordsHash: factsRecordsHash([], batch.agreements),
    people: null,
    paths: [{
      path: AGREEMENTS_PATH, pre,
      post: {
        index: { mode: "100644", oid: await repo.pathState.hashIndexBlob(AGREEMENTS_PATH, oldPost, true) },
        worktree: { kind: "file", mode: 0o644, oid: await repo.pathState.hashWorktreeBlob(oldPost, true) },
      },
    }],
  }
  const path = recovery.paths[0]
  if (path === undefined) throw new Error("missing recovery path")
  if (partial) {
    await repo.pathState.setIndex(path.path, path.post.index)
    await repo.pathState.writeWorktree(path.path, path.post.worktree)
  }
  return { root, repo, batch, recovery, pre }
}

for (const partial of [false, true]) {
  for (const [date, expected] of [["2026-10-01", 1], ["2026-10-02", 2]] as const) {
    test(`legacy recovery partial=${partial} date=${date} publishes migrated receipts with count ${expected}`, async () => {
      const { root, repo, batch, recovery, pre } = await fixture(date, partial)
      let published: FactsApplyRecovery | undefined
      const result = await applyFactsRecovery(repo, recovery, 1, AUTHOR, {
        batch,
        publishRecovery: async (next) => {
          expect(await repo.pathState.capture(AGREEMENTS_PATH)).toEqual(pre)
          published = next
        },
      })
      expect(result.outcome).toBe("committed")
      expect(published?.agreementEventVersion).toBe(1)
      expect(agreementItemsOf(await readFile(join(root, AGREEMENTS_PATH), "utf8"))[0]?.n).toBe(expected)
      expect((await applyFactsBatch(repo, { ...batch, batchId: randomUUID() }, AUTHOR)).outcome).toBe("no_facts")
      expect((await repo.status()).trim()).toBe("")
    }, 30_000)
  }
}

test("a failed commit after recovery publication leaves a resumable migrated envelope", async () => {
  const { root, repo, batch, recovery } = await fixture("2026-10-02", true)
  let published: FactsApplyRecovery | undefined
  const commit = repo.commitPrepared.bind(repo)
  repo.commitPrepared = async () => { throw new Error("fixture commit failure") }
  let failure: unknown
  try {
    await applyFactsRecovery(repo, recovery, 1, AUTHOR, {
      batch, publishRecovery: async (next) => { published = next },
    })
  } catch (error) { failure = error }
  if (!(failure instanceof Error)) throw new Error("expected commit failure")
  expect(failure.message).toBe("fixture commit failure")
  repo.commitPrepared = commit
  if (published === undefined) throw new Error("migration was not published")
  expect((await applyFactsRecovery(repo, published, 1, AUTHOR)).outcome).toBe("committed")
  expect(agreementItemsOf(await readFile(join(root, AGREEMENTS_PATH), "utf8"))[0]?.n).toBe(2)
}, 30_000)
