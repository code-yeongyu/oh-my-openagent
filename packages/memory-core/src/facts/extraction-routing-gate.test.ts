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

describe("person routing gate and unresolved mentions", () => {
  test("#given people routing is disabled #when a person fact arrives #then it falls back to the monthly notes file", async () => {
    // given
    const { dir, repo } = await fixture()

    // when
    await applyFactsBatch(repo, {
      batchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      records: [person()],
    }, AUTHOR, { people: { enabled: false, maxEntries: 40, maxEntryChars: 200 } })

    // then
    const memory = parseMemoryFile(await readFile(join(dir, "notes/facts/2026-08.md"), "utf8"))
    expect(memory.body).toContain("- [2026-08-10] Mina prefers concise reviews.")
    expect(existsSync(join(dir, "people", "mina"))).toBe(false)
  }, 30_000)

  test("#given an unresolved person mention #when applied #then the prefixed bullet is stored verbatim in monthly notes", async () => {
    // given
    const { dir, repo } = await fixture()

    // when
    await applyFactsBatch(repo, {
      batchId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      records: [{
        scope: "project",
        text: "person-unresolved: A teammate said the launch slips.",
        date: "2026-08-10",
      }],
    }, AUTHOR, { people: PEOPLE })

    // then
    const memory = parseMemoryFile(await readFile(join(dir, "notes/facts/2026-08.md"), "utf8"))
    expect(memory.body).toContain("- [2026-08-10] person-unresolved: A teammate said the launch slips.")
    expect(existsSync(join(dir, "people"))).toBe(false)
  }, 30_000)
})
