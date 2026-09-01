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

describe("person routing reinforcement", () => {
  test("#given an existing explicit observation #when a textually equal fact arrives #then n increments and the date refreshes without a duplicate line", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "mina", "Mina", ["Min"])
    await commitObservations(repo, "mina", "Mina", "## Explicit\n\n- [2026-08-01] Mina prefers concise reviews.\n")

    // when
    await applyFactsBatch(repo, {
      batchId: "88888888-8888-4888-8888-888888888888",
      records: [personRecord("Mina", [], "mina   prefers concise  reviews")],
    }, AUTHOR, { people: PEOPLE })

    // then
    const entries = await readExplicitEntries(dir, "mina")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ date: "2026-08-10", content: "Mina prefers concise reviews.", n: 2 })

    // when an nfkc-folded repeat arrives
    await applyFactsBatch(repo, {
      batchId: "99999999-9999-4999-8999-999999999999",
      records: [personRecord("Min", [], "Ｍｉｎａ prefers concise reviews", "2026-08-11")],
    }, AUTHOR, { people: PEOPLE })

    // then
    const reinforced = await readExplicitEntries(dir, "mina")
    expect(reinforced).toHaveLength(1)
    expect(reinforced[0]).toMatchObject({ date: "2026-08-11", content: "Mina prefers concise reviews.", n: 3 })
  }, 30_000)

  test("#given an existing explicit observation #when a different fact arrives #then it appends a separate line", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "mina", "Mina", ["Min"])
    await commitObservations(repo, "mina", "Mina", "## Explicit\n\n- [2026-08-01] Mina prefers concise reviews.\n")

    // when
    await applyFactsBatch(repo, {
      batchId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      records: [personRecord("Min", [], "Mina prefers dark themes.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    const entries = await readExplicitEntries(dir, "mina")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ date: "2026-08-01", content: "Mina prefers concise reviews." })
    expect(entries[1]).toMatchObject({ date: "2026-08-10", content: "Mina prefers dark themes." })
  }, 30_000)
})

describe("person routing new people", () => {
  test("#given no matching card #when a confidently named person fact arrives #then a card skeleton and ledger are created", async () => {
    // given
    const { dir, repo } = await fixture()

    // when
    const result = await applyFactsBatch(repo, {
      batchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      records: [personRecord("Yeongyu", ["YG"], "Yeongyu reviews on Tuesdays.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    expect(result.outcome).toBe("committed")
    if (result.outcome === "committed") {
      expect(result.affectedPaths).toEqual(["people/yeongyu/card.md", "people/yeongyu/observations.md"])
    }
    const card = parseMemoryFile(await readFile(join(dir, "people", "yeongyu", "card.md"), "utf8"))
    expect(card.frontmatter).toMatchObject({
      description: "Person - Yeongyu",
      kind: "person",
      aliases: ["YG"],
    })
    expect((await readExplicitEntries(dir, "yeongyu")).map((entry) => entry.content))
      .toEqual(["Yeongyu reviews on Tuesdays."])
  }, 30_000)

  test("#given a slug already taken by a different person #when a new person sanitizes to it #then a numeric suffix avoids the collision", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "yeongyu", "Yeongyu Kim", ["Yoshi"])

    // when
    await applyFactsBatch(repo, {
      batchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      records: [personRecord("Yeongyu", [], "Yeongyu joined the platform guild.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    const card = parseMemoryFile(await readFile(join(dir, "people", "yeongyu-2", "card.md"), "utf8"))
    expect(card.frontmatter).toMatchObject({ description: "Person - Yeongyu", kind: "person" })
    expect((await readExplicitEntries(dir, "yeongyu-2")).map((entry) => entry.content))
      .toEqual(["Yeongyu joined the platform guild."])
    expect(await readFile(join(dir, "people", "yeongyu", "observations.md"), "utf8").catch(() => undefined))
      .toBeUndefined()
  }, 30_000)

  test("#given two facts about the same new person in one batch #when applied #then one card receives both entries", async () => {
    // given
    const { dir, repo } = await fixture()

    // when
    await applyFactsBatch(repo, {
      batchId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      records: [
        personRecord("Yeongyu", ["YG"], "Yeongyu reviews on Tuesdays."),
        personRecord("YG", [], "YG drafted the alias table."),
      ],
    }, AUTHOR, { people: PEOPLE })

    // then
    expect(await readdir(join(dir, "people"))).toEqual(["yeongyu"])
    expect((await readExplicitEntries(dir, "yeongyu")).map((entry) => entry.content))
      .toEqual(["Yeongyu reviews on Tuesdays.", "YG drafted the alias table."])
  }, 30_000)
})
