import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { GitMemoryRepo } from "../git"
import { RECALL_TERM_STORE_NAME, RecallTermPersistence } from "./bm25-persist"
import { withRecallTermSavesExcluded } from "./bm25-persist-gate"
import { decodeRecallTermStore, encodeRecallTermStore } from "./bm25-store"
import { loadRecallCorpus, RecallCorpusCache, recallTermIndex, type RecallDocument } from "./provider"
import { selectRecallCandidates } from "./select"
import type { RecallStrategy } from "./strategy"

const TIMEOUT = process.platform === "win32" ? 60_000 : 30_000
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

// A fixed corpus large enough for the hybrid strategy (200+ notes), in four languages, with notes that
// share vocabulary so ranking order and scores depend on every document's terms and lengths.
const WORDS = [
  "deploy", "rollback", "checklists", "heap", "retainer", "snapshot", "release", "nationalization",
  "배포", "롤백했다", "메모리를", "데이터베이스", "東京", "記憶管理", "データベース", "中文检索", "ラーメン", "ＡＢＣ１２３",
]

function fixtureNotes(): Array<{ readonly relativePath: string; readonly content: string }> {
  return Array.from({ length: 220 }, (_, note) => {
    const body = Array.from({ length: 6 + (note % 9) }, (_, word) => WORDS[(note * 7 + word * 3) % WORDS.length]).join(" ")
    const description = `${WORDS[note % WORDS.length]} note ${note}`
    return { relativePath: `reference/n${String(note).padStart(3, "0")}.md`, content: `---\ndescription: ${description}\n---\n${body}\n` }
  })
}

const QUERIES: readonly (readonly string[])[] = [
  ["deploy rollback"], ["heap retainers"], ["데이터베이스 배포"], ["롤백"], ["記憶"], ["中文"], ["\"heap retainer\""], ["release", "東京"],
]
const STRATEGIES: readonly (RecallStrategy | undefined)[] = [undefined, "bm25", "hybrid", "substring"]

function rankAll(documents: readonly RecallDocument[]): unknown {
  return STRATEGIES.flatMap((strategy) =>
    QUERIES.map((queries) =>
      selectRecallCandidates(documents, queries, {
        maxItems: 50,
        surfaced: new Set(),
        ...(strategy === undefined ? {} : { strategy }),
        expansions: { synonyms: ["checklist"], related: ["ラーメン"] },
      }),
    ),
  )
}

async function createRepo(): Promise<{ readonly dir: string; readonly repo: GitMemoryRepo; readonly store: string }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-terms-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "recall-agent" })
  await repo.init({ seedFiles: fixtureNotes() })
  return { dir, repo, store: join(dir, ".git", RECALL_TERM_STORE_NAME) }
}

/** Ranks the repository in a new process through RecallCorpusCache, as the first prompt of a session does. */
async function rankInNewProcess(dir: string): Promise<unknown> {
  const script = join(dir, "..", `rank-${Math.random().toString(36).slice(2)}.ts`)
  await writeFile(script, `
    const core = await import(${JSON.stringify(join(import.meta.dir, "..", "index.ts"))})
    const { selectRecallCandidates } = await import(${JSON.stringify(join(import.meta.dir, "select.ts"))})
    const corpus = await new core.RecallCorpusCache({ termStore: () => import(${JSON.stringify(join(import.meta.dir, "bm25-persist.ts"))}) }).load(new core.GitMemoryRepo({ dir: ${JSON.stringify(dir)}, agentId: "child" }))
    const queries = ${JSON.stringify(QUERIES)}
    const strategies = ${JSON.stringify(STRATEGIES.map((strategy) => strategy ?? null))}
    console.log(JSON.stringify(strategies.flatMap((strategy) => queries.map((planned) => selectRecallCandidates(corpus.documents, planned, {
      maxItems: 50, surfaced: new Set(), ...(strategy === null ? {} : { strategy }),
      expansions: { synonyms: ["checklist"], related: ["ラーメン"] },
    })))))
  `)
  tempDirs.push(script)
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`ranking child exited ${code}: ${stderr}`)
  return JSON.parse(stdout)
}

async function persisted(dir: string, documents: readonly RecallDocument[]): Promise<RecallTermPersistence> {
  const persistence = new RecallTermPersistence(dir, (error) => {
    throw error
  }, recallTermIndex)
  await persistence.attach(documents)
  return persistence
}

describe("persisted recall terms", () => {
  // RecallCorpusCache.settled() is the public wait a caller uses before it removes or hands off a repository:
  // without it the save started by a ranking can still be writing into `.git` when the directory goes away.
  // A restore replaces the repository under the store: the exclusion is what keeps a save out of the half-restored tree.
  it("#given a repository under exclusion #when a ranking starts a save inside it #then nothing is written into .git", async () => {
    // given
    const { dir, repo } = await createRepo()
    const cache = new RecallCorpusCache({ termStore: () => import("./bm25-persist") })
    const documents = (await cache.load(repo)).documents

    // when
    await withRecallTermSavesExcluded(dir, async () => {
      rankAll(documents)
      await cache.settled()
    })
    await cache.settled()

    // then
    const written = (await readdir(join(dir, ".git"))).filter((name) => name.startsWith(RECALL_TERM_STORE_NAME))
    expect(written).toEqual([])
  }, TIMEOUT)

  it("#given a cache whose ranking started a save #when settled resolves #then the store is written and no temp file remains", async () => {
    // given
    const { dir, repo, store } = await createRepo()
    const cache = new RecallCorpusCache({ termStore: () => import("./bm25-persist") })
    rankAll((await cache.load(repo)).documents)

    // when
    await cache.settled()

    // then
    expect((await stat(store)).isFile()).toBe(true)
    const temps = (await readdir(join(dir, ".git"))).filter((name) => name.startsWith(`${RECALL_TERM_STORE_NAME}.`))
    expect(temps).toEqual([])
  }, TIMEOUT)

  it("#given a store written by an earlier process #when a new process ranks #then every candidate equals the tokenized ranking and nothing is re-tokenized", async () => {
    // given
    const { dir, store } = await createRepo()
    const tokenized = await rankInNewProcess(dir)
    const written = await stat(store)

    // when
    const fromStore = await rankInNewProcess(dir)

    // then
    expect(fromStore).toEqual(tokenized)
    expect((await stat(store)).ino).toBe(written.ino)
  }, TIMEOUT)

  it("#given a process whose dictionary already holds other terms #when it seeds from the store #then rankings equal the tokenized ones", async () => {
    // given
    const { dir, repo } = await createRepo()
    await rankInNewProcess(dir)
    const reversed = [...WORDS].reverse().join(" ")
    const unrelated = Array.from({ length: 3 }, (_, note) => ({ path: `u${note}.md`, description: "", body: `zephyr${note} ${reversed}` }))
    selectRecallCandidates(unrelated, ["zephyr0"], { maxItems: 1, surfaced: new Set(), strategy: "bm25" })
    const expected = rankAll((await loadRecallCorpus(repo)).documents)

    // when
    const documents = (await loadRecallCorpus(repo)).documents
    const persistence = await persisted(dir, documents)
    const ranked = rankAll(documents)
    await persistence.settled()

    // then
    expect(ranked).toEqual(expected)
  }, TIMEOUT)

  it.each([
    ["truncated", (bytes: Uint8Array) => bytes.subarray(0, bytes.length - 3)],
    ["from another tokenizer", (bytes: Uint8Array) => {
      const store = decodeRecallTermStore(bytes)
      if (store === undefined) throw new Error("fixture store did not decode")
      return encodeRecallTermStore({ ...store, fingerprint: "other-tokenizer" })
    }],
    ["not a store", () => new TextEncoder().encode("garbage")],
  ])("#given a store %s #when ranked #then rankings equal the tokenized ones and the store is rewritten", async (_, damage) => {
    // given
    const { dir, repo, store } = await createRepo()
    await rankInNewProcess(dir)
    const expected = rankAll((await loadRecallCorpus(repo)).documents)
    await writeFile(store, damage(new Uint8Array(await readFile(store))))
    const damaged = await stat(store)

    // when
    const documents = (await loadRecallCorpus(repo)).documents
    const persistence = await persisted(dir, documents)
    const ranked = rankAll(documents)
    await persistence.settled()

    // then
    expect(ranked).toEqual(expected)
    expect((await stat(store)).ino).not.toBe(damaged.ino)
    expect(decodeRecallTermStore(new Uint8Array(await readFile(store)))?.documents.size).toBe(documents.length)
  }, TIMEOUT)

  it("#given a memory write after the store was saved #when the next process ranks #then the changed note ranks by its new text and the store follows it", async () => {
    // given
    const { dir, repo, store } = await createRepo()
    await rankInNewProcess(dir)
    await writeFile(join(dir, "reference/n000.md"), "---\ndescription: lighthouse beacon\n---\nlighthouse deploy rollback\n")
    await repo.commitWrite(["reference/n000.md"], "edit note", { agentId: "recall-agent", authorName: "Recall Agent" })

    // when
    const fromStore = await rankInNewProcess(dir)
    const lighthouse = selectRecallCandidates((await loadRecallCorpus(repo)).documents, ["lighthouse"], { maxItems: 5, surfaced: new Set() })

    // then
    expect(fromStore).toEqual(rankAll((await loadRecallCorpus(repo)).documents))
    expect(lighthouse.map((candidate) => candidate.path)).toEqual(["reference/n000.md"])
    expect(decodeRecallTermStore(new Uint8Array(await readFile(store)))?.documents.size).toBe(220)
  }, TIMEOUT)

  it("#given temp files left by a dead save and by a live one #when the store is saved #then only the stale one is removed", async () => {
    // given
    const { dir, repo, store } = await createRepo()
    const stale = `${store}.1.dead.tmp`
    const live = `${store}.2.live.tmp`
    await writeFile(stale, "x")
    await writeFile(live, "x")
    const hourAgo = new Date(Date.now() - 3_600_000)
    await utimes(stale, hourAgo, hourAgo)

    // when
    const documents = (await loadRecallCorpus(repo)).documents
    const persistence = await persisted(dir, documents)
    rankAll(documents)
    await persistence.settled()

    // then
    const left = (await readdir(join(dir, ".git"))).filter((name) => name.startsWith(RECALL_TERM_STORE_NAME))
    expect(left.sort()).toEqual([RECALL_TERM_STORE_NAME, `${RECALL_TERM_STORE_NAME}.2.live.tmp`])
  }, TIMEOUT)
})
