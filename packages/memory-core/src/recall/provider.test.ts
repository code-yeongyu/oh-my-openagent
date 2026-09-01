import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"
import { RecallCorpusCache, loadRecallCorpus } from "./provider"

const GIT_INTEGRATION_TEST_TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

const tempDirs: string[] = []

async function createRepo(): Promise<{ dir: string; repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-provider-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })
  await repo.init({
    seedFiles: [
      { relativePath: "system/persona.md", content: "---\ndescription: persona\n---\nsystem body\n" },
      { relativePath: "system/state.md", content: "---\ndescription: internal state\n---\ncounters\n" },
      {
        relativePath: "reference/architecture.md",
        content: "---\ndescription: Architecture overview\n---\nThe service mesh routes edge traffic.\n",
      },
      {
        relativePath: "people/alice.md",
        content: "---\ndescription: Alice the backend lead\n---\nOwns the ingest pipeline.\n",
      },
      { relativePath: "notes/plain.txt", content: "not markdown\n" },
      { relativePath: "skills/git.md", content: "---\ndescription: Git conventions\n---\nUse merge commits.\n" },
      { relativePath: "notes/broken.md", content: "missing frontmatter entirely\n" },
    ],
  })
  return { dir, repo }
}

async function createBareDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-no-repo-")))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

describe("loadRecallCorpus", () => {
  it("#given a committed HEAD tree #when the corpus is loaded #then only non-system parseable markdown survives", async () => {
    // given
    const { repo } = await createRepo()

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    expect(corpus.revision).toBe(await repo.head())
    expect(corpus.documents.map((document) => document.path)).toEqual([
      "people/alice.md",
      "reference/architecture.md",
      "skills/git.md",
    ])
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given committed files #when documents are parsed #then description and body come from frontmatter parsing", async () => {
    // given
    const { repo } = await createRepo()

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    const alice = corpus.documents.find((document) => document.path === "people/alice.md")
    expect(alice?.description).toBe("Alice the backend lead")
    expect(alice?.body).toContain("Owns the ingest pipeline.")
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a committed file whose path merely contains a system segment #when the corpus is loaded #then only the reserved root system tree is excluded", async () => {
    // given: reference/system/deploy.md is a normal memory file; system/persona.md is reserved
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-system-tree-")))
    tempDirs.push(dir)
    const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })
    await repo.init({
      seedFiles: [
      {
        relativePath: "reference/system/deploy.md",
        content: "---\ndescription: Deployment notes under a system-named folder\n---\nRoll forward on failure.\n",
      },
      {
        relativePath: "system/persona.md",
        content: "---\ndescription: Persona\n---\nsystem body\n",
      },
      ],
    })

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    expect(corpus.documents.map((document) => document.path)).toEqual(["reference/system/deploy.md"])
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given uncommitted working-tree edits #when the corpus is loaded #then only committed HEAD content is visible", async () => {
    // given
    const { dir, repo } = await createRepo()
    await writeFile(join(dir, "reference/architecture.md"), "---\ndescription: Uncommitted edit\n---\ndirty body\n")
    await writeFile(join(dir, "reference/untracked.md"), "---\ndescription: Untracked file\n---\nnever committed\n")

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    const architecture = corpus.documents.find((document) => document.path === "reference/architecture.md")
    expect(architecture?.description).toBe("Architecture overview")
    expect(corpus.documents.map((document) => document.path)).not.toContain("reference/untracked.md")
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a directory that is not a git repository #when the corpus is loaded #then the revision is null and no documents load", async () => {
    // given
    const dir = await createBareDir()
    const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })

    // when
    const corpus = await loadRecallCorpus(repo)

    // then
    expect(corpus.revision).toBeNull()
    expect(corpus.documents).toEqual([])
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given HEAD advances with a new recallable file #when the corpus reloads #then the new revision and document appear", async () => {
    // given
    const { dir, repo } = await createRepo()
    const before = await loadRecallCorpus(repo)
    await writeFile(join(dir, "notes/deploy.md"), "---\ndescription: Deployment runbook\n---\nRoll forward on failure.\n")
    await repo.commitWrite(["notes/deploy.md"], "add deploy runbook", {
      agentId: "recall-agent",
      authorName: "Recall Agent",
    })

    // when
    const after = await loadRecallCorpus(repo)

    // then
    expect(after.revision).not.toBe(before.revision)
    expect(after.documents.map((document) => document.path)).toContain("notes/deploy.md")
    expect(after.documents.map((document) => document.path)).toEqual([
      "notes/deploy.md",
      "people/alice.md",
      "reference/architecture.md",
      "skills/git.md",
    ])
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})

describe("RecallCorpusCache", () => {
  it("#given an unchanged HEAD #when the corpus loads twice #then the cached corpus object is reused", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new RecallCorpusCache()

    // when
    const first = await cache.load(repo)
    const second = await cache.load(repo)

    // then
    expect(second).toBe(first)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given HEAD changes #when the corpus reloads #then the cache invalidates and the new corpus is loaded", async () => {
    // given
    const { dir, repo } = await createRepo()
    const cache = new RecallCorpusCache()
    const first = await cache.load(repo)
    await writeFile(join(dir, "notes/deploy.md"), "---\ndescription: Deployment runbook\n---\nRoll forward.\n")
    await repo.commitWrite(["notes/deploy.md"], "add deploy runbook", {
      agentId: "recall-agent",
      authorName: "Recall Agent",
    })

    // when
    const second = await cache.load(repo)

    // then
    expect(second).not.toBe(first)
    expect(second.revision).not.toBe(first.revision)
    expect(second.documents.map((document) => document.path)).toContain("notes/deploy.md")
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a cleared cache #when the corpus reloads #then the corpus is reloaded even at the same HEAD", async () => {
    // given
    const { repo } = await createRepo()
    const cache = new RecallCorpusCache()
    const first = await cache.load(repo)

    // when
    cache.clear()
    const second = await cache.load(repo)

    // then
    expect(second).not.toBe(first)
    expect(second.documents).toEqual(first.documents)
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})
