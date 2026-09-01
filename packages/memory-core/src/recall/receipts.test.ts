import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendRecallReceipt } from "./receipts"

const tempDirs: string[] = []

async function createDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-receipts-")))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

describe("appendRecallReceipt", () => {
  it("#given a receipt #when appended #then one JSON line with every field lands", async () => {
    // given
    const dir = await createDir()
    const filePath = join(dir, "receipts.jsonl")

    // when
    await appendRecallReceipt(filePath, {
      sessionId: "session-1",
      at: "2026-08-31T10:00:00.000Z",
      queries: ["kubernetes", '"ingress gateway"'],
      injected: [{ path: "reference/a.md", score: 12 }],
    })

    // then
    const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      sessionId: "session-1",
      at: "2026-08-31T10:00:00.000Z",
      queries: ["kubernetes", '"ingress gateway"'],
      injected: [{ path: "reference/a.md", score: 12 }],
    })
  })

  it("#given two receipts #when appended #then both lines persist in order", async () => {
    // given
    const dir = await createDir()
    const filePath = join(dir, "receipts.jsonl")

    // when
    await appendRecallReceipt(filePath, {
      sessionId: "session-1",
      at: "2026-08-31T10:00:00.000Z",
      queries: ["alpha"],
      injected: [],
    })
    await appendRecallReceipt(filePath, {
      sessionId: "session-1",
      at: "2026-08-31T10:05:00.000Z",
      queries: ["beta"],
      injected: [{ path: "notes/b.md", score: 3 }],
    })

    // then
    const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean)
    expect(lines).toHaveLength(2)
    expect((JSON.parse(lines[0] ?? "") as { queries: string[] }).queries).toEqual(["alpha"])
    expect((JSON.parse(lines[1] ?? "") as { queries: string[] }).queries).toEqual(["beta"])
  })

  it("#given a receipts path with missing parents #when appended #then the parents are created", async () => {
    // given
    const dir = await createDir()
    const filePath = join(dir, "recall", "nested", "receipts.jsonl")

    // when
    await appendRecallReceipt(filePath, {
      sessionId: "session-1",
      at: "2026-08-31T10:00:00.000Z",
      queries: [],
      injected: [],
    })

    // then
    const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
  })

  it("#given a newly created receipts file #when the mode is inspected #then it is private to the owner", async () => {
    // given
    const dir = await createDir()
    const filePath = join(dir, "receipts.jsonl")

    // when
    await appendRecallReceipt(filePath, {
      sessionId: "session-1",
      at: "2026-08-31T10:00:00.000Z",
      queries: [],
      injected: [],
    })

    // then
    if (process.platform === "win32") {
      expect(await stat(filePath)).toBeDefined()
    } else {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
  })
})
