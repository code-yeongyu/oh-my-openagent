import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo, createNodeGitExec, type GitExec, type GitExecOptions } from "../git"
import { RecallCorpusCache, loadRecallCorpus } from "./provider"
import { removeTree } from "../../../../test-support/remove-tree"

// A circuit breaker, not a sync point: each case runs ~15 real git processes, which a loaded host stretches.
const GIT_INTEGRATION_TEST_TIMEOUT = 60_000
const FILE_COUNT = 40
const AUTHOR = { agentId: "recall-agent", authorName: "Recall Agent" }

interface RecordedRun {
  readonly argv: readonly string[]
  readonly stdin: GitExecOptions["stdin"]
}

const tempDirs: string[] = []

function countingExec(): { readonly exec: GitExec; readonly runs: RecordedRun[] } {
  const inner = createNodeGitExec()
  const runs: RecordedRun[] = []
  return {
    runs,
    exec: {
      run(argv, options) {
        runs.push({ argv, stdin: options.stdin })
        return inner.run(argv, options)
      },
    },
  }
}

function memoryFile(index: number): { relativePath: string; content: string } {
  return {
    relativePath: `reference/note-${String(index).padStart(2, "0")}.md`,
    content: `---\ndescription: Note ${index} 메모리 노트 🧠\n---\n본문 ${index}: 한국어와 emoji 🚀 bytes.\n`,
  }
}

async function createRepo(): Promise<{ dir: string; repo: GitMemoryRepo; runs: RecordedRun[] }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-git-budget-")))
  tempDirs.push(dir)
  const { exec, runs } = countingExec()
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId, exec })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: persona\n---\nsystem body\n" },
      { relativePath: "notes/broken.md", content: "missing frontmatter entirely\n" },
      ...Array.from({ length: FILE_COUNT }, (_, index) => memoryFile(index)),
    ],
  })
  runs.length = 0
  return { dir, repo, runs }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

describe("recall corpus git process budget", () => {
  it("#given a repo of many memory files #when the corpus loads #then git runs a constant number of processes, not one per file", async () => {
    // given
    const { repo, runs } = await createRepo()

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    expect(runs.map((run) => run.argv[0])).toEqual(["rev-parse", "ls-tree", "cat-file"])
    expect(corpus.documents).toHaveLength(FILE_COUNT)
    const note = corpus.documents.find((document) => document.path === "reference/note-07.md")
    expect(note?.description).toBe("Note 7 메모리 노트 🧠")
    expect(note?.body).toBe("본문 7: 한국어와 emoji 🚀 bytes.\n")
    expect(corpus.documents.map((document) => document.path)).not.toContain("notes/broken.md")
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a cached corpus #when HEAD moves with one edit and one delete #then only the edited blob is read and unchanged documents are reused", async () => {
    // given
    const { dir, repo, runs } = await createRepo()
    const cache = new RecallCorpusCache()
    const first = await cache.load(repo)
    const unchanged = first.documents.find((document) => document.path === "reference/note-01.md")
    await writeFile(join(dir, "reference/note-02.md"), "---\ndescription: Edited note\n---\nnew body\n")
    await rm(join(dir, "reference/note-03.md"))
    await repo.commitWrite(["reference/note-02.md", "reference/note-03.md"], "edit and delete", AUTHOR)
    const editedOid = (await repo.lsTreeBlobs("HEAD")).find((entry) => entry.path === "reference/note-02.md")?.oid
    runs.length = 0

    // when
    const second = await cache.load(repo)

    // then
    const catFiles = runs.filter((run) => run.argv[0] === "cat-file")
    expect(catFiles.map((run) => run.stdin)).toEqual([`${editedOid}\n`])
    expect(runs).toHaveLength(3)
    expect(second.documents.find((document) => document.path === "reference/note-01.md")).toBe(unchanged)
    expect(second.documents.find((document) => document.path === "reference/note-02.md")?.description).toBe("Edited note")
    expect(second.documents.map((document) => document.path)).not.toContain("reference/note-03.md")
    expect(second.documents).toHaveLength(FILE_COUNT - 1)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a cached corpus #when HEAD moves without touching recall files #then no blob is read at all", async () => {
    // given
    const { dir, repo, runs } = await createRepo()
    const cache = new RecallCorpusCache()
    const first = await cache.load(repo)
    await writeFile(join(dir, "system/persona.md"), "---\ndescription: persona\n---\nedited system body\n")
    await repo.commitWrite(["system/persona.md"], "edit system block", AUTHOR)
    runs.length = 0

    // when
    const second = await cache.load(repo)

    // then
    expect(runs.map((run) => run.argv[0])).toEqual(["rev-parse", "ls-tree"])
    expect(second.revision).not.toBe(first.revision)
    expect(second.documents).toEqual(first.documents)
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})
