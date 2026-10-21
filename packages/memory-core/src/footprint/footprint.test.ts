import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "../identity"
import { removeTree } from "../../../../test-support/remove-tree"
import { formatMemoryFootprint, measureMemoryFootprint } from "./footprint"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

describe("memory footprint", () => {
  it("#given files across the layout #when measured #then bytes land in their areas and the line ranks them", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-footprint-")))
    tempDirs.push(root)
    const paths = buildIdentityPaths(join(root, "memory"), "agent")
    await mkdir(join(paths.repo, "system"), { recursive: true })
    await mkdir(join(paths.transcripts, "s1"), { recursive: true })
    await mkdir(paths.factsQueue, { recursive: true })
    await writeFile(join(paths.repo, "system", "persona.md"), "p".repeat(1000))
    await writeFile(join(paths.transcripts, "s1", "transcript.jsonl"), "t".repeat(5000))
    await writeFile(join(paths.factsQueue, "consumed.json"), "f".repeat(10))
    await writeFile(join(paths.runtime, "receipts.jsonl"), "r".repeat(20))

    // when
    const footprint = await measureMemoryFootprint(paths)
    const capped = await measureMemoryFootprint(paths, { maxEntries: 2 })

    // then
    expect(footprint).toMatchObject({ totalBytes: 6030, files: 4, truncated: false })
    expect(footprint.areas).toMatchObject({ repo: 1000, transcripts: 5000, facts: 10, other: 20 })
    expect(formatMemoryFootprint(footprint)).toBe("5.9 KiB (transcripts 4.9 KiB, repo 1000 B, other 20 B, facts 10 B)")
    expect(capped.truncated).toBe(true)
    expect(formatMemoryFootprint(capped).includes("+")).toBe(true)
  })
})
