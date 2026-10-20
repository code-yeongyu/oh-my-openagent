import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { GitMemoryRepo, RecallCorpusCache, selectRecallCandidates, type RecallTermStoreModule } from "@oh-my-opencode/memory-core"
import { withRecallTermSavesExcluded } from "@oh-my-opencode/memory-core/recall-store"
import { rmEfaultTolerant } from "./teardown.test-support"

// The built sidecar carries its own copy of the save gate, and `/memfs restore` takes the gate from another
// bundle. Only a gate whose state is shared per process keeps a sidecar-loaded save out of a restore.
const SIDECAR = join(import.meta.dir, "..", "..", "..", "plugin", "extensions", "omo-recall-store.js")

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rmEfaultTolerant(root, { recursive: true, force: true })
})

describe("recall store sidecar", () => {
  it("#given the store loaded from the built sidecar #when a ranking saves while the repository is excluded #then nothing is written into .git", async () => {
    // given
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-recall-store-sidecar-")))
    roots.push(dir)
    const repo = new GitMemoryRepo({ dir, agentId: "sidecar-agent" })
    await repo.init({
      seedFiles: Array.from({ length: 12 }, (_, note) => ({
        relativePath: `reference/n${note}.md`,
        content: `---\ndescription: deploy note ${note}\n---\nrollback checklist heap retainer ${note}\n`,
      })),
    })
    const cache = new RecallCorpusCache({
      termStore: async (): Promise<RecallTermStoreModule> => import(pathToFileURL(SIDECAR).href),
    })
    const documents = (await cache.load(repo)).documents

    // when
    await withRecallTermSavesExcluded(dir, async () => {
      selectRecallCandidates(documents, ["rollback"], { maxItems: 3, surfaced: new Set(), strategy: "bm25" })
      await cache.settled()
    })
    await cache.settled()

    // then
    const written = (await readdir(join(dir, ".git"))).filter((name) => name.startsWith("omo-recall-bm25-terms"))
    expect(written).toEqual([])
  })
})
