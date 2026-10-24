import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo, type GitExec } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { parsePeopleCard, type ObservationEntry } from "../people"
import { buildDefaultSeedFiles } from "../seeds"
import { MIXED_PROVENANCE, readHeader } from "../tools/claim-frontmatter"
import {
  applyFactsBatch,
  parseFactsExtractionJsonl,
  type FactsExtractionRecord,
} from "./extraction"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR = { agentId: "facts-agent", authorName: "Facts Extractor" }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
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
  test("never creates an empty card for a genuinely new supported identity", async () => {
    const { dir, repo } = await fixture()
    await applyFactsBatch(repo, {
      batchId: "cccccccc-1111-4111-8111-111111111111",
      records: [personRecord("Riley", ["R"], "Riley joined the platform team.")],
    }, AUTHOR, { people: PEOPLE })

    const saved = parseMemoryFile(await readFile(join(dir, "people/riley/card.md"), "utf8"))
    const parsed = parsePeopleCard(saved.body, PEOPLE_LIMITS)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.card.entries).toEqual([{ prefix: "IDENTITY", content: "Riley" }])
    expect((await readExplicitEntries(dir, "riley")).map((entry) => entry.content))
      .toEqual(["Riley joined the platform team."])
  }, 30_000)

  test("does not mutate a read-only identity while routing connected aliases in the batch", async () => {
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "alex", "Alex Example", ["Alex"])
    const path = join(dir, "people/alex/card.md")
    const before = renderMemoryFile({
      description: "Person - Alex Example", aliases: ["Alex"], read_only: "true",
    }, "IDENTITY: Alex Example\n")
    await writeFile(path, before)
    await repo.commitWrite(["people/alex/card.md"], "test: protect identity", AUTHOR)
    await applyFactsBatch(repo, {
      batchId: "dddddddd-1111-4111-8111-111111111111",
      records: [
        personRecord("Alex", ["Supervisor"], "Alex is also called Supervisor."),
        personRecord("Supervisor", [], "Supervisor reviewed the plan."),
      ],
    }, AUTHOR, { people: PEOPLE })

    expect(await readFile(path, "utf8")).toBe(before)
    expect(await readdir(join(dir, "people"))).toEqual(["alex"])
    expect(await readExplicitEntries(dir, "alex")).toHaveLength(2)
  }, 30_000)

  test("retains a connected alias across committed extraction batches", async () => {
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "alex", "Alex Example", ["Alex"])
    const path = join(dir, "people/alex/card.md")
    const body = "IDENTITY: Alex Example\nATTRIBUTE: Platform engineer\n"
    await writeFile(path, renderMemoryFile({
      description: "Person - Alex Example",
      kind: "person",
      aliases: ["Alex"],
      extra: { provenance: JSON.stringify("inferred from a synthetic fixture") },
    }, body))
    await repo.commitWrite(["people/alex/card.md"], "test: seed identity content", AUTHOR)

    await applyFactsBatch(repo, {
      batchId: "11111111-1111-4111-8111-111111111111",
      records: [personRecord("Alex", ["Supervisor"], "Alex is also called Supervisor.")],
    }, AUTHOR, { people: PEOPLE })
    await applyFactsBatch(repo, {
      batchId: "22222222-2222-4222-8222-222222222222",
      records: [personRecord("Supervisor", [], "Supervisor reviewed the plan.")],
    }, AUTHOR, { people: PEOPLE })

    expect(await readdir(join(dir, "people"))).toEqual(["alex"])
    const saved = parseMemoryFile(await readFile(path, "utf8"))
    expect(saved.frontmatter.aliases).toEqual(["Alex", "Supervisor"])
    expect(saved.body).toBe(body)
    expect(readHeader(saved.frontmatter)).toBe("inferred from a synthetic fixture")
    expect((await readExplicitEntries(dir, "alex")).map((entry) => entry.content))
      .toEqual(["Alex is also called Supervisor.", "Supervisor reviewed the plan."])
  }, 30_000)

  test("updates the identity index through a same-batch alias chain", async () => {
    const { dir, repo } = await fixture()
    await commitPersonCard(repo, "alex", "Alex Example", ["Alex"])
    await applyFactsBatch(repo, {
      batchId: "33333333-3333-4333-8333-333333333333",
      records: [
        personRecord("Alex", ["Supervisor"], "Alex is also called Supervisor."),
        personRecord("Lead", ["Supervisor"], "Supervisor is also called Lead."),
        personRecord("Lead", [], "Lead reviewed the plan."),
      ],
    }, AUTHOR, { people: PEOPLE })

    expect(await readdir(join(dir, "people"))).toEqual(["alex"])
    const saved = parseMemoryFile(await readFile(join(dir, "people/alex/card.md"), "utf8"))
    expect(saved.frontmatter.aliases).toEqual(["Alex", "Supervisor", "Lead"])
    expect(await readExplicitEntries(dir, "alex")).toHaveLength(3)
  }, 30_000)

  test("creates a genuinely new card with supported identity content and accumulated aliases", async () => {
    const { dir, repo } = await fixture()
    await applyFactsBatch(repo, {
      batchId: "aaaaaaaa-1111-4111-8111-111111111111",
      records: [
        personRecord("Riley", ["R"], "Riley is also called R."),
        personRecord("R", ["Reviewer"], "R is also called Reviewer."),
        personRecord("Reviewer", [], "Reviewer joined the platform team."),
      ],
    }, AUTHOR, { people: PEOPLE })

    expect(await readdir(join(dir, "people"))).toEqual(["riley"])
    const saved = parseMemoryFile(await readFile(join(dir, "people/riley/card.md"), "utf8"))
    const parsed = parsePeopleCard(saved.body, PEOPLE_LIMITS)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.card.entries).toEqual([{ prefix: "IDENTITY", content: "Riley" }])
    expect(saved.frontmatter.aliases).toEqual(["R", "Reviewer"])
    expect(await readExplicitEntries(dir, "riley")).toHaveLength(3)
  }, 30_000)

  test("enriches the primary human at its canonical path without claiming user provenance", async () => {
    const { dir, repo } = await fixture()
    const path = join(dir, "system/human.md")
    const body = "IDENTITY: Fixture Human\n"
    await writeFile(path, renderMemoryFile({
      description: "Person - Fixture Human",
      kind: "person",
      aliases: ["Primary"],
      extra: { provenance: JSON.stringify("user replied yes; a record, not the user's approval") },
    }, body))
    await repo.commitWrite(["system/human.md"], "test: seed primary human", AUTHOR)

    const result = await applyFactsBatch(repo, {
      batchId: "bbbbbbbb-1111-4111-8111-111111111111",
      records: [
        personRecord("Primary", ["Owner"], "Primary is also called Owner."),
        personRecord("Owner", [], "Owner reviewed the plan."),
      ],
    }, AUTHOR, { people: PEOPLE })

    expect(result.outcome).toBe("committed")
    if (result.outcome === "committed") {
      expect(result.affectedPaths).toEqual(["people/human/observations.md", "system/human.md"])
    }
    const saved = parseMemoryFile(await readFile(path, "utf8"))
    expect(saved.frontmatter.aliases).toEqual(["Primary", "Owner"])
    expect(saved.body).toBe(body)
    expect(readHeader(saved.frontmatter)).toBe(MIXED_PROVENANCE)
    expect(await readdir(join(dir, "people"))).toEqual(["human"])
    expect(existsSync(join(dir, "people/human/card.md"))).toBe(false)
    expect(await readExplicitEntries(dir, "human")).toHaveLength(2)
  }, 30_000)

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
