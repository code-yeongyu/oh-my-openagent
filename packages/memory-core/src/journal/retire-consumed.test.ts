import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { RETIRED_IDS_FILE } from "./retire"
import { retireConsumedTranscriptJournals } from "./retire-consumed"

const tempDirs: string[] = []
const NOW = Date.parse("2026-10-22T00:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function transcriptsDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-retire-consumed-")))
  tempDirs.push(dir)
  return dir
}

/** A journal of `bytes` transcript rows, last appended `ageMs` before NOW. */
async function seedJournal(root: string, id: string, options: { bytes: number; ageMs: number; reflected: boolean }): Promise<string> {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  const rows: string[] = []
  let size = 0
  for (let index = 0; size < options.bytes; index += 1) {
    const row = JSON.stringify({
      kind: index % 2 === 0 ? "user" : "assistant",
      text: "y".repeat(2000),
      captured_at: "2026-01-01T00:00:00.000Z",
      source_line_id: `${id}-m${index}:x`,
      source_message_id: `${id}-m${index}`,
    })
    rows.push(row)
    size += row.length + 1
  }
  await writeFile(join(dir, "transcript.jsonl"), `${rows.join("\n")}\n`)
  const steps = Math.floor(rows.length / 2)
  await writeFile(join(dir, "state.json"), JSON.stringify({
    schema_version: "v3_assistant_steps",
    total_completed_steps: steps,
    reflected_completed_steps: options.reflected ? steps : 0,
    steps_since_last_successful_reflection: options.reflected ? 0 : steps,
    ...(options.reflected ? { reflected_through_message_id: `${id}-m${rows.length - 1}` } : {}),
  }))
  const at = new Date(NOW - options.ageMs)
  for (const name of ["transcript.jsonl", "state.json"]) await utimes(join(dir, name), at, at)
  return dir
}

async function diskBytes(root: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size
  }
  return total
}

describe("consumed transcript journal retirement", () => {
  it("#given a synthetic 48-session history #when the pass runs #then only consumed idle journals shrink to their keys and unconsumed data is untouched", async () => {
    // given: 48 idle sessions of 256 KiB, every other one consumed, plus a live and a recent consumed session
    const root = await transcriptsDir()
    for (let index = 0; index < 48; index += 1) {
      await seedJournal(root, `old-${String(index).padStart(2, "0")}`, { bytes: 256 * 1024, ageMs: (8 + index) * DAY, reflected: index % 2 === 0 })
    }
    await seedJournal(root, "live", { bytes: 256 * 1024, ageMs: 30 * DAY, reflected: true })
    await seedJournal(root, "recent", { bytes: 256 * 1024, ageMs: 2 * DAY, reflected: true })
    const before = await diskBytes(root)

    // when
    const result = await retireConsumedTranscriptJournals({ transcriptsDir: root, now: () => NOW, isLive: (id) => id === "live" })

    // then
    expect(result.retired).toHaveLength(24)
    expect(result.kept).toEqual({ live: 1, recent: 1, unconsumed: 24 })
    expect(result.freedBytes).toBeGreaterThan(24 * 256 * 1024)
    expect(await diskBytes(root)).toBeLessThan(before - result.freedBytes + 64 * 1024)
    for (const id of result.retired) {
      expect(Number(id.slice(4)) % 2).toBe(0)
      expect(existsSync(join(root, id, "transcript.jsonl"))).toBe(false)
      expect(existsSync(join(root, id, RETIRED_IDS_FILE))).toBe(true)
    }
    expect(existsSync(join(root, "old-01", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(root, "live", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(root, "recent", "transcript.jsonl"))).toBe(true)
  })

  it("#given the facts lane refuses a conversation #when the pass runs #then that journal is kept and counted", async () => {
    // given
    const root = await transcriptsDir()
    await seedJournal(root, "queued", { bytes: 64 * 1024, ageMs: 8 * DAY, reflected: true })
    const asked: string[] = []

    // when
    const result = await retireConsumedTranscriptJournals({
      transcriptsDir: root,
      now: () => NOW,
      releaseConversation: async (id) => {
        asked.push(id)
        return false
      },
    })

    // then
    expect(asked).toEqual(["queued"])
    expect(result.retired).toEqual([])
    expect(result.kept["facts-pending"]).toBe(1)
    expect(existsSync(join(root, "queued", "transcript.jsonl"))).toBe(true)
  })

  it("#given no transcripts directory #when the pass runs #then nothing is reported", async () => {
    const root = await transcriptsDir()
    const result = await retireConsumedTranscriptJournals({ transcriptsDir: join(root, "missing"), now: () => NOW })
    expect(result).toEqual({ retired: [], freedBytes: 0, kept: {} })
  })
})
