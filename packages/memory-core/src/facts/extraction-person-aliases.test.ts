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

describe("person routing alias resolution", () => {
  test("#given an existing card with a known alias #when a person fact names that alias #then it lands in the card ledger and no new directory appears", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "mina", "Mina", ["Min"])

    // when
    const result = await applyFactsBatch(repo, {
      batchId: "44444444-4444-4444-8444-444444444444",
      records: [personRecord("Min", [], "Min is reviewing the memory plan.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    expect(result.outcome).toBe("committed")
    const entries = await readExplicitEntries(dir, "mina")
    expect(entries.map((entry) => entry.content)).toEqual(["Min is reviewing the memory plan."])
    expect(entries[0]?.date).toBe("2026-08-10")
    expect(entries[0]?.n).toBeUndefined()
    expect(await readdir(join(dir, "people"))).toEqual(["mina"])
  }, 30_000)

  test("#given two cards whose aliases both match #when resolved #then the longest matching alias wins", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "mina-kim", "Mina Kim", ["Min"])
    await commitPersonCard(repo, "mina-lee", "Mina Lee", ["Mina"])

    // when
    await applyFactsBatch(repo, {
      batchId: "55555555-5555-4555-8555-555555555555",
      records: [personRecord("Mina", ["Min"], "Mina reviewed the plan.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    expect((await readExplicitEntries(dir, "mina-lee")).map((entry) => entry.content))
      .toEqual(["Mina reviewed the plan."])
    expect(await readFile(join(dir, "people", "mina-kim", "observations.md"), "utf8").catch(() => undefined))
      .toBeUndefined()
  }, 30_000)

  test("#given two cards with equal-length matching aliases #when resolved #then the smallest slug wins and the tie is logged", async () => {
    // given
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "bbb-min", "Min Bbb", ["Min"])
    await commitPersonCard(repo, "aaa-min", "Min Aaa", ["Min"])
    const ties: { alias: string; slugs: readonly string[]; chosen: string }[] = []

    // when
    await applyFactsBatch(repo, {
      batchId: "66666666-6666-4666-8666-666666666666",
      records: [personRecord("Min", [], "Min joined the platform guild.")],
    }, AUTHOR, { people: PEOPLE, onAliasTie: (tie) => ties.push(tie) })

    // then
    expect((await readExplicitEntries(dir, "aaa-min")).map((entry) => entry.content))
      .toEqual(["Min joined the platform guild."])
    expect(ties).toEqual([{ alias: "Min", slugs: ["aaa-min", "bbb-min"], chosen: "aaa-min" }])
  }, 30_000)

  test("#given the primary human card carries an alias #when a fact names it #then it routes to the human ledger without a new card", async () => {
    // given
    const { dir, repo } = await fixture()
    await writeFile(
      join(dir, "system", "human.md"),
      renderMemoryFile({ description: "Person - Human", kind: "person", aliases: ["Lo"] }, ""),
      "utf8",
    )
    await repo.commitWrite(["system/human.md"], "test: alias the human", AUTHOR)

    // when
    const result = await applyFactsBatch(repo, {
      batchId: "77777777-7777-4777-8777-777777777777",
      records: [personRecord("Lo", [], "Lo prefers dark themes.")],
    }, AUTHOR, { people: PEOPLE })

    // then
    expect(result.outcome).toBe("committed")
    if (result.outcome === "committed") {
      expect(result.affectedPaths).toEqual(["people/human/observations.md"])
    }
    expect((await readExplicitEntries(dir, "human")).map((entry) => entry.content))
      .toEqual(["Lo prefers dark themes."])
    expect(existsSync(join(dir, "people", "human", "card.md"))).toBe(false)
  }, 30_000)
})
