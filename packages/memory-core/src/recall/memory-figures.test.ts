import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { recallBm25IndexFor, recallTermFigures } from "./bm25-index"
import { RecallCorpusCache, type RecallDocument, recallMemoryFigures } from "./provider"
import { removeTree } from "../../../../test-support/remove-tree"

const GIT_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function createRepo(): Promise<GitMemoryRepo> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-figures-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })
  await repo.init({
    seedFiles: [
      { relativePath: "reference/one.md", content: "---\ndescription: First topic\n---\nFirst body.\n" },
      { relativePath: "reference/two.md", content: "---\ndescription: Second topic\n---\nSecond body text.\n" },
    ],
  })
  return repo
}

function textBytes(documents: readonly RecallDocument[]): number {
  return documents.reduce((sum, document) => sum + 2 * (document.path.length + document.description.length + document.body.length), 0)
}

// The memory report (senpi#2564) reads these figures on demand to attribute a session's heap to the
// recall corpus (oh-my-openagent#9442). A shared corpus counts once however many sessions hold it.
describe("recallMemoryFigures", () => {
  it("#given two shared caches over one repository #when a report reads the figures #then the corpus counts once", async () => {
    // given
    const repo = await createRepo()
    Bun.gc(true)
    const before = recallMemoryFigures()
    const first = new RecallCorpusCache({ shared: true })
    const second = new RecallCorpusCache({ shared: true })
    const corpus = await first.load(repo)
    await second.load(repo)

    // when
    Bun.gc(true)
    const after = recallMemoryFigures()

    // then
    expect(corpus.documents.length).toBe(2)
    expect(after.corpusCaches - before.corpusCaches).toBe(1)
    expect(after.documents - before.documents).toBe(2)
    expect(after.documentTextBytes - before.documentTextBytes).toBe(textBytes(corpus.documents))
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})

describe("recallTermFigures", () => {
  it("#given an indexed document #when its figures are read #then they count its term arrays", () => {
    // given
    const document: RecallDocument = { path: "reference/x.md", description: "x", body: "y" }
    recallBm25IndexFor([document], () => ({ terms: ["alpha", "beta", "alpha"], length: 3 }))

    // when
    const figures = recallTermFigures([document])

    // then
    expect(figures.termArrayBytes).toBe(16)
    expect(figures.vocabularyTerms).toBeGreaterThanOrEqual(2)
  })

  it("#given a document never indexed #when its figures are read #then it adds no term bytes", () => {
    // given
    const document: RecallDocument = { path: "reference/never.md", description: "n", body: "n" }

    // when
    const figures = recallTermFigures([document])

    // then
    expect(figures.termArrayBytes).toBe(0)
  })
})
