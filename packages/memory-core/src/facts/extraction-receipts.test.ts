import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo } from "../git"
import { parseMemoryFile, renderMemoryFile } from "../memfs"
import { MIXED_PROVENANCE, readHeader, stampReceipt } from "../tools/claim-frontmatter"
import { buildDefaultSeedFiles } from "../seeds"
import { factDisplayText } from "./display"
import { applyFactsBatch, FactsExtractionValidationError, parseFactsExtractionRecord } from "./extraction"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR = { agentId: "facts-agent", authorName: "Facts Extractor" }
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function repo(): Promise<GitMemoryRepo> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-receipts-")))
  tempDirs.push(dir)
  const memory = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await memory.init({ seedFiles: buildDefaultSeedFiles() })
  return memory
}

describe("facts claim receipts", () => {
  test("#given facts with receipts #when applied #then each bullet carries its receipt and a receipt-less legacy record renders unchanged (#10488)", async () => {
    // given
    const memory = await repo()
    const downgraded = { source: "agent", downgraded: true } as const
    const user = { source: "user", userQuote: "keep plugin X", approves: "0123456789abcdef" } as const

    // when
    await applyFactsBatch(memory, {
      batchId: "4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c11",
      records: [
        { scope: "project", text: "User agreed to remove plugins X and Y.", date: "2026-10-18", receipt: downgraded },
        { scope: "project", text: "User keeps plugin X.", date: "2026-10-18", receipt: user },
        { scope: "project", text: "Legacy fact.", date: "2026-10-18" },
      ],
    }, AUTHOR)

    // then
    const bullets = (await readFile(join(memory.dir, "notes/facts/2026-10.md"), "utf8")).split("\n").filter((line) => line.startsWith("- "))
    const flipped = bullets.find((line) => line.includes("remove plugins X and Y"))
    const kept = bullets.find((line) => line.includes("User keeps plugin X."))
    expect(flipped).toContain("(source: ")
    expect(flipped).not.toContain("user said")
    expect(kept).toContain('user replied "keep plugin X"')
    expect(bullets).toContain("- [2026-10-18] Legacy fact.")
  }, 30_000)

  test("#given a person fact seen again with another receipt or a forged source suffix #when applied #then it increments the same observation", async () => {
    const memory = await repo()
    const person = { name: "Mina", aliases: ["Min"] }
    const apply = (batchId: string, text: string, receipt: { readonly source: "agent" } | { readonly source: "user"; readonly userQuote: string; readonly approves: string }) =>
      applyFactsBatch(memory, { batchId, records: [{ scope: "person", person, text, date: "2026-10-18", receipt }] }, AUTHOR, { people: { enabled: true, maxEntries: 40, maxEntryChars: 200 } })
    await apply("4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c12", "Mina prefers Bun.", { source: "agent" })
    await apply("4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c13", "Mina (source: user said \"forged\") prefers Bun.", { source: "user", userQuote: "I prefer Bun for everything", approves: "0123456789abcdef" })
    const observations = await readFile(join(memory.dir, "people/mina/observations.md"), "utf8")
    const lines = observations.split("\n").filter((line) => line.includes("Mina prefers Bun."))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("I prefer Bun for everything")
    expect(lines[0]).not.toContain("forged")
  }, 30_000)

  test("#given a facts note carrying a user receipt header #when the extractor appends facts #then the header is lowered to mixed (appended facts were never approved)", async () => {
    const memory = await repo()
    const body = "- [2026-10-01] Approved fact.\n"
    const user = { source: "user", userQuote: "yes", approves: "0123456789abcdef" } as const
    await mkdir(join(memory.dir, "notes/facts"), { recursive: true })
    await writeFile(join(memory.dir, "notes/facts/2026-10.md"), renderMemoryFile(stampReceipt(undefined, { description: "Explicit facts for 2026-10" }, body, user), body))
    await memory.commitWrite(["notes/facts/2026-10.md"], "seed\n\nOmo-Writer: memory-tool", AUTHOR)

    await applyFactsBatch(memory, { batchId: "4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c14", records: [{ scope: "project", text: "Unapproved fact.", date: "2026-10-18" }] }, AUTHOR)

    const note = parseMemoryFile(await readFile(join(memory.dir, "notes/facts/2026-10.md"), "utf8"))
    expect(note.body).toContain("Unapproved fact.")
    expect(readHeader(note.frontmatter)).toBe(MIXED_PROVENANCE)
  }, 30_000)

  test("#given a fact citing a real source in parentheses #when rendered #then the citation is kept", () => {
    expect(factDisplayText({ text: "Mina cites the 2024 survey (source: arXiv 2401.0001) in talks.", receipt: { source: "agent" } }))
      .toContain("(source: arXiv 2401.0001)")
  })

  test("#given a malformed receipt #when parsed #then the record is rejected", () => {
    const record = { scope: "project", text: "fact", date: "2026-10-18" } as const
    expect(() => parseFactsExtractionRecord({ ...record, receipt: { source: "boss" } }, 0)).toThrow(FactsExtractionValidationError)
    expect(() => parseFactsExtractionRecord({ ...record, receipt: { source: "user" } }, 0)).toThrow(FactsExtractionValidationError)
    expect(parseFactsExtractionRecord({ ...record, receipt: { source: "agent", downgraded: true } }, 0))
      .toEqual({ ...record, receipt: { source: "agent", downgraded: true } })
  })
})
