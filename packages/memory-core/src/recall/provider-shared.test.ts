import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync, symlinkSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { RecallCorpusCache } from "./provider"
import { removeTree } from "../../../../test-support/remove-tree"

const GIT_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

const tempDirs: string[] = []

async function createRepo(description: string): Promise<{ dir: string; repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-shared-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })
  await repo.init({
    seedFiles: [
      { relativePath: "reference/topic.md", content: `---\ndescription: ${description}\n---\nBody.\n` },
    ],
  })
  return { dir, repo }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

// Contract: on a multi-session host every session builds its own cache, so a shared cache is what
// keeps one parsed corpus (and the BM25 index keyed by its document array) per memory repository.
describe("RecallCorpusCache shared mode", () => {
  it("#given two sessions' shared caches #when both load one repository #then they hold the same corpus", async () => {
    // given
    const { dir } = await createRepo("Shared topic")
    const first = new RecallCorpusCache({ shared: true })
    const second = new RecallCorpusCache({ shared: true })

    // when
    const a = await first.load(new GitMemoryRepo({ dir, agentId: "session-a" }))
    const b = await second.load(new GitMemoryRepo({ dir, agentId: "session-b" }))

    // then
    expect(b).toBe(a)
    expect(b.documents).toBe(a.documents)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given shared caches over two repositories #when each loads #then each repository keeps its own corpus", async () => {
    // given
    const left = await createRepo("Left topic")
    const right = await createRepo("Right topic")
    const cache = new RecallCorpusCache({ shared: true })

    // when
    const leftCorpus = await cache.load(left.repo)
    const rightCorpus = await cache.load(right.repo)
    const leftAgain = await new RecallCorpusCache({ shared: true }).load(left.repo)

    // then
    expect(leftCorpus.documents.map((document) => document.description)).toEqual(["Left topic"])
    expect(rightCorpus.documents.map((document) => document.description)).toEqual(["Right topic"])
    expect(leftAgain).toBe(leftCorpus)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a memory write by one session #when another session's shared cache reloads #then it sees the new revision", async () => {
    // given
    const { dir, repo } = await createRepo("Before")
    const writer = new RecallCorpusCache({ shared: true })
    const reader = new RecallCorpusCache({ shared: true })
    const before = await reader.load(repo)
    await writeFile(join(dir, "reference/after.md"), "---\ndescription: After\n---\nNew.\n")
    await repo.commitWrite(["reference/after.md"], "add note", { agentId: "recall-agent", authorName: "Recall Agent" })

    // when
    const afterWriter = await writer.load(repo)
    const afterReader = await reader.load(repo)

    // then
    expect(afterReader).toBe(afterWriter)
    expect(afterReader.revision).not.toBe(before.revision)
    expect(afterReader.documents.map((document) => document.path)).toContain("reference/after.md")
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given one repository reached through a symlinked path #when two sessions load it #then they share one corpus", async () => {
    // given
    const { dir } = await createRepo("Linked")
    const linkParent = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-shared-link-")))
    tempDirs.push(linkParent)
    const linked = join(linkParent, "memory")
    symlinkSync(dir, linked, "dir")

    // when
    const direct = await new RecallCorpusCache({ shared: true }).load(new GitMemoryRepo({ dir, agentId: "session-a" }))
    const viaLink = await new RecallCorpusCache({ shared: true }).load(new GitMemoryRepo({ dir: linked, agentId: "session-b" }))

    // then
    expect(viaLink).toBe(direct)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given an unshared cache #when it loads a repository a shared cache already holds #then it keeps a private corpus", async () => {
    // given
    const { repo } = await createRepo("Private")
    const shared = await new RecallCorpusCache({ shared: true }).load(repo)

    // when
    const own = await new RecallCorpusCache().load(repo)

    // then
    expect(own).not.toBe(shared)
    expect(own.revision).toBe(shared.revision)
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})
