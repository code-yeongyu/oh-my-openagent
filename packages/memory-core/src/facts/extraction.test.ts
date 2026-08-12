import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo, type GitExec } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { parsePeopleCard, type ObservationEntry } from "../people"
import { buildDefaultSeedFiles } from "../seeds"
import {
  applyFactsBatch,
  parseFactsExtractionJsonl,
  type FactsExtractionRecord,
} from "./extraction"

const AUTHOR = { agentId: "facts-agent", authorName: "Facts Extractor" }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(exec?: GitExec): Promise<{ readonly dir: string; readonly repo: GitMemoryRepo }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-extraction-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId, ...(exec === undefined ? {} : { exec }) })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  return { dir, repo }
}

function project(text = "The project uses Bun."): FactsExtractionRecord {
  return { scope: "project", text, date: "2026-08-10" }
}

function person(text = "Mina prefers concise reviews."): FactsExtractionRecord {
  return {
    scope: "person",
    person: { name: "Mina", aliases: ["Min"] },
    text,
    date: "2026-08-10",
  }
}

function personRecord(
  name: string,
  aliases: readonly string[],
  text: string,
  date = "2026-08-10",
): FactsExtractionRecord {
  return { scope: "person", person: { name, aliases: [...aliases] }, text, date }
}

const PEOPLE = { enabled: true, maxEntries: 40, maxEntryChars: 200 } as const
const PEOPLE_LIMITS = { maxEntries: 40, maxEntryChars: 200 } as const

async function commitPersonCard(
  repo: GitMemoryRepo,
  slug: string,
  name: string,
  aliases: readonly string[],
): Promise<void> {
  await mkdir(join(repo.dir, "people", slug), { recursive: true })
  await writeFile(
    join(repo.dir, "people", slug, "card.md"),
    renderMemoryFile({ description: `Person - ${name}`, kind: "person", aliases }, ""),
    "utf8",
  )
  await repo.commitWrite([`people/${slug}/card.md`], `test: seed ${slug} card`, AUTHOR)
}

async function commitObservations(
  repo: GitMemoryRepo,
  slug: string,
  name: string,
  body: string,
): Promise<void> {
  await mkdir(join(repo.dir, "people", slug), { recursive: true })
  await writeFile(
    join(repo.dir, "people", slug, "observations.md"),
    renderMemoryFile({ description: `Observations - ${name}` }, body),
    "utf8",
  )
  await repo.commitWrite([`people/${slug}/observations.md`], `test: seed ${slug} observations`, AUTHOR)
}

async function readExplicitEntries(dir: string, slug: string): Promise<readonly ObservationEntry[]> {
  const memory = parseMemoryFile(await readFile(join(dir, "people", slug, "observations.md"), "utf8"))
  const { card, diagnostics } = parsePeopleCard(memory.body, PEOPLE_LIMITS)
  expect(diagnostics).toEqual([])
  return card.observations?.find((group) => group.section === "Explicit")?.entries ?? []
}

describe("facts extraction JSONL validation", () => {
  test("#given valid project and person arms #when parsed #then scope remains a discriminated union", () => {
    // given
    const raw = `${JSON.stringify(project())}\n${JSON.stringify(person())}\n`

    // when
    const records = parseFactsExtractionJsonl(raw)

    // then
    expect(records).toEqual([project(), person()])
  }, 30_000)

  test("#given a project record carrying person #when parsed #then the whole extraction is rejected", () => {
    // given
    const raw = JSON.stringify({ ...project(), person: { name: "Mina", aliases: [] } })

    // when
    const operation = () => parseFactsExtractionJsonl(raw)

    // then
    expect(operation).toThrow("project record must not carry person")
  }, 30_000)

  test("#given a person record missing person #when parsed #then the whole extraction is rejected", () => {
    // given
    const raw = JSON.stringify({ scope: "person", text: "Mina prefers Bun.", date: "2026-08-10" })

    // when
    const operation = () => parseFactsExtractionJsonl(raw)

    // then
    expect(operation).toThrow("person record requires person")
  }, 30_000)
})

describe("atomic facts batch application", () => {
  test("#given project and resolved person records #when applied without a people policy #then one notes commit preserves both texts and trailers", async () => {
    // given
    const { dir, repo } = await fixture()

    // when
    const result = await applyFactsBatch(repo, {
      batchId: "11111111-1111-4111-8111-111111111111",
      records: [project(), person()],
    }, AUTHOR)

    // then
    expect(result.outcome).toBe("committed")
    if (result.outcome !== "committed") throw new Error("expected a committed facts batch")
    const memory = parseMemoryFile(await readFile(join(dir, "notes/facts/2026-08.md"), "utf8"))
    expect(memory.body).toContain("- [2026-08-10] The project uses Bun.")
    expect(memory.body).toContain("- [2026-08-10] Mina prefers concise reviews.")
    const [commit] = await repo.log({ range: "HEAD~1..HEAD" })
    expect(commit?.sha).toBe(result.sha)
    expect(commit?.subject).toBe("chore(facts): extract 2 facts")
    expect(commit?.trailers["Generated-By"]).toBe("facts-extractor")
    expect(commit?.trailers["Omo-Writer"]).toBe("facts-extractor")
    expect(commit?.trailers["Omo-Facts-Batch"]).toBe("11111111-1111-4111-8111-111111111111")
  }, 30_000)

  test("#given zero applicable records #when applied #then no commit is attempted", async () => {
    // given
    const { repo } = await fixture()
    const before = await repo.head()

    // when
    const result = await applyFactsBatch(repo, {
      batchId: "22222222-2222-4222-8222-222222222222",
      records: [],
    }, AUTHOR)

    // then
    expect(result).toEqual({ outcome: "no_facts", affectedPaths: [] })
    expect(await repo.head()).toBe(before)
  }, 30_000)

  test("#given git commit fails after staging #when the batch aborts #then index and working tree are restored", async () => {
    // given
    const base = createNodeGitExec()
    let rejectCommit = false
    const exec: GitExec = {
      run: async (args, options) => {
        if (rejectCommit && args.includes("commit")) {
          return { code: 1, stdout: "", stderr: "injected commit failure" }
        }
        return base.run(args, options)
      },
    }
    const { dir, repo } = await fixture(exec)
    rejectCommit = true

    // when
    const operation = applyFactsBatch(repo, {
      batchId: "33333333-3333-4333-8333-333333333333",
      records: [project()],
    }, AUTHOR)

    // then
    await expect(operation).rejects.toThrow("injected commit failure")
    expect(await repo.status()).toBe("")
    expect(await readFile(join(dir, "notes/facts/2026-08.md"), "utf8").catch(() => undefined)).toBeUndefined()
  }, 30_000)
})
