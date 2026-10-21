import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { enforceTranscriptBudget } from "./budget"
import { RETIRED_IDS_FILE } from "./retire"
import { TranscriptJournal } from "./store"

const tempDirs: string[] = []
const NOW = Date.parse("2026-10-22T00:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000
const MIB = 1024 * 1024

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function transcriptsDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-budget-")))
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
  const state = {
    schema_version: "v3_assistant_steps",
    total_completed_steps: Math.floor(rows.length / 2),
    reflected_completed_steps: options.reflected ? Math.floor(rows.length / 2) : 0,
    steps_since_last_successful_reflection: options.reflected ? 0 : Math.floor(rows.length / 2),
    ...(options.reflected ? { reflected_through_message_id: `${id}-m${rows.length - 1}` } : {}),
  }
  await writeFile(join(dir, "state.json"), JSON.stringify(state))
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

describe("transcript storage budget", () => {
  it("#given a synthetic 48-session history far over budget #when enforced #then the store lands under budget and live or recent work survives", async () => {
    // given: 48 idle sessions of 512 KiB (24 MiB), half reflected, plus a live and a recent session
    const root = await transcriptsDir()
    for (let index = 0; index < 48; index += 1) {
      await seedJournal(root, `old-${String(index).padStart(2, "0")}`, { bytes: 512 * 1024, ageMs: (10 + index) * DAY, reflected: index % 2 === 0 })
    }
    await seedJournal(root, "live", { bytes: 512 * 1024, ageMs: 30 * DAY, reflected: false })
    await seedJournal(root, "recent", { bytes: 512 * 1024, ageMs: 60 * 60 * 1000, reflected: false })
    const budgetBytes = 4 * MIB
    expect(await diskBytes(root)).toBeGreaterThan(25 * MIB)

    // when
    const result = await enforceTranscriptBudget({ transcriptsDir: root, budgetBytes, now: () => NOW, isLive: (id) => id === "live" })

    // then
    const onDisk = await diskBytes(root)
    expect(onDisk).toBeLessThanOrEqual(budgetBytes)
    expect(result.bytesAfter).toBe(onDisk)
    expect(result.retired).toHaveLength(24)
    expect(result.evicted.length).toBeGreaterThan(0)
    expect(result.kept.live).toBe(1)
    expect(existsSync(join(root, "live", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(root, "recent", "transcript.jsonl"))).toBe(true)
    // Eviction takes the least recently active first: the newest unreflected idle session survives.
    expect(result.evicted).not.toContain("old-01")
    expect(result.evicted).toContain("old-47")
  })

  it("#given a store already under budget #when enforced #then only consumed idle journals are retired", async () => {
    // given
    const root = await transcriptsDir()
    await seedJournal(root, "reflected-old", { bytes: 64 * 1024, ageMs: 8 * DAY, reflected: true })
    await seedJournal(root, "reflected-fresh", { bytes: 64 * 1024, ageMs: 2 * DAY, reflected: true })
    await seedJournal(root, "unreflected-old", { bytes: 64 * 1024, ageMs: 30 * DAY, reflected: false })

    // when
    const result = await enforceTranscriptBudget({ transcriptsDir: root, now: () => NOW })

    // then
    expect(result.retired).toEqual(["reflected-old"])
    expect(result.evicted).toEqual([])
    expect(existsSync(join(root, "reflected-old", RETIRED_IDS_FILE))).toBe(true)
    expect(existsSync(join(root, "reflected-fresh", "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(root, "unreflected-old", "transcript.jsonl"))).toBe(true)
  })

  it("#given the facts lane refuses a conversation #when enforced #then that journal is kept and counted", async () => {
    // given
    const root = await transcriptsDir()
    await seedJournal(root, "queued", { bytes: 64 * 1024, ageMs: 8 * DAY, reflected: true })
    const asked: string[] = []

    // when
    const result = await enforceTranscriptBudget({
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

  it("#given a retired marker past its ttl #when enforced #then the directory is removed and a replay journals afresh", async () => {
    // given
    const root = await transcriptsDir()
    const dir = await seedJournal(root, "ancient", { bytes: 16 * 1024, ageMs: 200 * DAY, reflected: true })
    await enforceTranscriptBudget({ transcriptsDir: root, now: () => NOW - 100 * DAY })
    const marker = new Date(NOW - 95 * DAY)
    await utimes(join(dir, RETIRED_IDS_FILE), marker, marker)
    await utimes(join(dir, "state.json"), marker, marker)

    // when
    const result = await enforceTranscriptBudget({ transcriptsDir: root, now: () => NOW })
    const replay = await new TranscriptJournal({ journalDir: dir }).reconcile([{ kind: "user", messageId: "ancient-m0", text: "again" }])

    // then
    expect(result.expired).toEqual(["ancient"])
    expect(replay.appended).toBe(1)
  })

  it("#given no transcripts directory #when enforced #then it reports an empty store", async () => {
    const root = await transcriptsDir()
    const result = await enforceTranscriptBudget({ transcriptsDir: join(root, "missing"), now: () => NOW })
    expect(result).toMatchObject({ bytesBefore: 0, bytesAfter: 0, retired: [], evicted: [], expired: [] })
  })
})
