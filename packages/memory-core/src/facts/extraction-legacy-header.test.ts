import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo } from "../git"
import { installHooks, normalizeMemoryFrontmatter, parseMemoryFile } from "../memfs"
import { buildDefaultSeedFiles } from "../seeds"
import { PROVENANCE_STRIPPED_TRAILER, readHeader } from "../tools/claim-frontmatter"
import { applyFactsBatch } from "./extraction"
import { removeTree } from "../../../../test-support/remove-tree"

const AUTHOR = { agentId: "facts-agent", authorName: "Facts Extractor" }
const PEOPLE = { people: { enabled: true, maxEntries: 40, maxEntryChars: 200 } }
const PERSON = { name: "Mina", aliases: ["Min"] }
const OBSERVATIONS = "people/mina/observations.md"
const LEGACY = '"user said \\"yes\\" approving proposal 0123456789abcdef (body sha256:0123456789abcdef)"'
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function hookedRepo(): Promise<GitMemoryRepo> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-facts-legacy-")))
  tempDirs.push(dir)
  const memory = new GitMemoryRepo({ dir, agentId: AUTHOR.agentId })
  await memory.init({ seedFiles: buildDefaultSeedFiles() })
  installHooks(dir, { checker: { execPath: process.execPath, script: join(import.meta.dir, "../memfs/memory-hook-cli.ts") } })
  return memory
}

const personFact = (batchId: string, text: string) =>
  ({ batchId, records: [{ scope: "person", person: PERSON, text, date: "2026-10-18" }] }) as const

describe("facts writer and the commit hook share one header rule (lead decision C on #10498)", () => {
  test("#given a person file carrying a legacy user header #when the facts extractor appends an observation #then the commit lands with the header dropped and the drop recorded", async () => {
    const memory = await hookedRepo()
    await applyFactsBatch(memory, personFact("4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c21", "Mina prefers Bun."), AUTHOR, PEOPLE)
    const seeded = await readFile(join(memory.dir, OBSERVATIONS), "utf8")
    await writeFile(join(memory.dir, OBSERVATIONS), seeded.replace("\n---\n", `\nprovenance: ${LEGACY}\n---\n`))
    await memory.commitWrite([OBSERVATIONS], "legacy approval\n\nOmo-Writer: memory-tool", AUTHOR)

    const result = await applyFactsBatch(memory, personFact("4b0f6f0e-6a55-4a43-9a8c-2f0d5f7d3c22", "Mina reviews on Fridays."), AUTHOR, PEOPLE)

    const note = parseMemoryFile(await readFile(join(memory.dir, OBSERVATIONS), "utf8"))
    expect(note.body).toContain("Mina reviews on Fridays.")
    expect(readHeader(note.frontmatter)).toBeUndefined()
    const [commit] = await memory.log({ limit: 1 })
    expect(result.outcome).toBe("committed")
    expect(commit?.sha).toBe("sha" in result ? result.sha : "<no commit>")
    expect(commit?.trailers[PROVENANCE_STRIPPED_TRAILER]).toBe(OBSERVATIONS)
  }, 60_000)

  test("#given a note with a legacy user header and a frontmatter grammar violation #when normalization rewrites it #then the commit lands with the header dropped and the drop recorded", async () => {
    const memory = await hookedRepo()
    // An older build wrote this note; seeding it bypasses the hooks, and normalization's own commit runs through them.
    await writeFile(join(memory.dir, "reference/legacy.md"), `---\ndescription: Run the chain: verify, merge\nprovenance: ${LEGACY}\n---\n\nnote body\n`)
    await Bun.$`git -C ${memory.dir} add reference/legacy.md && git -C ${memory.dir} -c user.name=seed -c user.email=seed@omo.local commit --no-verify -q -m seed`.quiet()

    const result = await normalizeMemoryFrontmatter(memory, AUTHOR)

    expect(result.status).toBe("normalized")
    const note = parseMemoryFile(await readFile(join(memory.dir, "reference/legacy.md"), "utf8"))
    expect(note.frontmatter.description).toBe("Run the chain: verify, merge")
    expect(readHeader(note.frontmatter)).toBeUndefined()
    const [commit] = await memory.log({ limit: 1 })
    expect(commit?.trailers[PROVENANCE_STRIPPED_TRAILER]).toBe("reference/legacy.md")
  }, 60_000)
})
