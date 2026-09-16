import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RecallLedger, recallLedgerDiskReads, sanitizeSessionFilename } from "./ledger"

const tempDirs: string[] = []

async function createLedgerDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-ledger-")))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

describe("sanitizeSessionFilename", () => {
  it("#given a plain session id #when sanitized #then it survives unchanged", () => {
    // given / when / then
    expect(sanitizeSessionFilename("sess-abc_123")).toBe("sess-abc_123")
  })

  it("#given an unsafe session id #when sanitized #then colons, separators and globs collapse to dashes", () => {
    // given / when / then
    const sanitized = sanitizeSessionFilename("a:b/../c?d*e")
    expect(sanitized).not.toMatch(/[:\\/?*]/)
    expect(sanitized).toBe("a-b-..-c-d-e")
  })

  it("#given path traversal or empty input #when sanitized #then a safe fallback name results", () => {
    // given / when / then
    expect(sanitizeSessionFilename("..")).toBe("session")
    expect(sanitizeSessionFilename(".")).toBe("session")
    expect(sanitizeSessionFilename("///")).toBe("session")
    expect(sanitizeSessionFilename("")).toBe("session")
  })
})

describe("RecallLedger", () => {
  it("#given an unknown session #when surfaced paths are read #then the set is empty", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)

    // when
    const surfaced = await ledger.surfacedPaths("missing-session")

    // then
    expect(surfaced.size).toBe(0)
  })

  it("#given a malformed ledger file #when surfaced paths are read #then the set is empty and nothing throws", async () => {
    // given
    const dir = await createLedgerDir()
    await writeFile(join(dir, "broken.json"), "{not json", "utf8")
    const ledger = new RecallLedger(dir)

    // when / then
    expect(await ledger.surfacedPaths("broken")).toEqual(new Set())
  })

  it("#given marked entries #when surfaced paths are read #then exactly those paths return", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await ledger.markSurfaced("session-1", [
      { path: "reference/a.md", hash: "aaaa" },
      { path: "notes/b.md", hash: "bbbb" },
    ])

    // when
    const surfaced = await ledger.surfacedPaths("session-1")

    // then
    expect(surfaced).toEqual(new Set(["reference/a.md", "notes/b.md"]))
  })

  it("#given marked entries #when the ledger file is inspected #then the versioned shape and mode are pinned", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)

    // when
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])

    // then
    const filePath = join(dir, "session-1.json")
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number
      surfaced: Record<string, { hash: string; at: string }>
    }
    expect(parsed.version).toBe(1)
    expect(Object.keys(parsed.surfaced)).toEqual(["reference/a.md"])
    expect(parsed.surfaced["reference/a.md"]?.hash).toBe("aaaa")
    expect(parsed.surfaced["reference/a.md"]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    if (process.platform !== "win32") {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
  })

  it("#given a second mark on the same session #when the ledger is read #then earlier entries persist and repeats update", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "first" }])

    // when
    await ledger.markSurfaced("session-1", [
      { path: "reference/a.md", hash: "second" },
      { path: "notes/b.md", hash: "bbbb" },
    ])

    // then
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set(["reference/a.md", "notes/b.md"]))
    const parsed = JSON.parse(await readFile(join(dir, "session-1.json"), "utf8")) as {
      surfaced: Record<string, { hash: string }>
    }
    expect(parsed.surfaced["reference/a.md"]?.hash).toBe("second")
  })

  it("#given two sessions #when both mark entries #then separate files hold separate sets", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)

    // when
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])
    await ledger.markSurfaced("session-2", [{ path: "notes/b.md", hash: "bbbb" }])

    // then
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set(["reference/a.md"]))
    expect(await ledger.surfacedPaths("session-2")).toEqual(new Set(["notes/b.md"]))
    expect((await readdir(dir)).sort()).toEqual(["session-1.json", "session-2.json"])
  })

  it("#given an unsafe session id #when entries are marked #then the file lands sanitized inside the ledger dir", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)

    // when
    await ledger.markSurfaced("a:b?c", [{ path: "reference/a.md", hash: "aaaa" }])

    // then
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).not.toMatch(/[:\\/?*]/)
    expect(await ledger.surfacedPaths("a:b?c")).toEqual(new Set(["reference/a.md"]))
  })

  it("#given no entries #when marking #then nothing is written", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)

    // when
    await ledger.markSurfaced("session-1", [])

    // then
    expect(await readdir(dir)).toEqual([])
  })

  it("#given an unchanged session file #when surfaced paths are read twice #then the file is parsed once", async () => {
    // given: recall reads this ledger on every prompt and every tool call (#8335)
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await writeFile(
      join(dir, "session-1.json"),
      `${JSON.stringify({
        version: 1,
        surfaced: { "reference/a.md": { hash: "aaaa", at: "2026-09-16T00:00:00.000Z" } },
      }, null, 2)}\n`,
      "utf8",
    )
    const before = recallLedgerDiskReads()

    // when
    const first = await ledger.surfacedPaths("session-1")
    const second = await ledger.surfacedPaths("session-1")

    // then
    expect(first).toEqual(new Set(["reference/a.md"]))
    expect(second).toEqual(first)
    expect(recallLedgerDiskReads() - before).toBe(1)
  })

  it("#given this instance's own markSurfaced #when surfaced paths are read #then the write updated the cache", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])
    await ledger.surfacedPaths("session-1")

    // when
    await ledger.markSurfaced("session-1", [{ path: "notes/b.md", hash: "bbbb" }])
    const before = recallLedgerDiskReads()
    const surfaced = await ledger.surfacedPaths("session-1")

    // then
    expect(surfaced).toEqual(new Set(["reference/a.md", "notes/b.md"]))
    expect(recallLedgerDiskReads() - before).toBe(0)
  })

  it("#given an external rewrite of the session file #when surfaced paths are read #then the new content wins", async () => {
    // given: another process (or another instance) can own the same ledger file
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set(["reference/a.md"]))

    // when
    await writeFile(
      join(dir, "session-1.json"),
      `${JSON.stringify({
        version: 1,
        surfaced: {
          "reference/a.md": { hash: "aaaa", at: "2026-09-16T00:00:00.000Z" },
          "notes/external.md": { hash: "cccc", at: "2026-09-16T00:00:00.000Z" },
        },
      }, null, 2)}\n`,
      "utf8",
    )
    const surfaced = await ledger.surfacedPaths("session-1")

    // then
    expect(surfaced).toEqual(new Set(["reference/a.md", "notes/external.md"]))
  })

  it("#given a deleted session file #when surfaced paths are read #then the cached set is dropped", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(dir)
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set(["reference/a.md"]))

    // when
    await rm(join(dir, "session-1.json"))

    // then
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set())
  })

  it("#given a ledger dir that does not exist yet #when entries are marked #then the directory is created", async () => {
    // given
    const dir = await createLedgerDir()
    const ledger = new RecallLedger(join(dir, "ledger"))

    // when
    await ledger.markSurfaced("session-1", [{ path: "reference/a.md", hash: "aaaa" }])

    // then
    expect(await ledger.surfacedPaths("session-1")).toEqual(new Set(["reference/a.md"]))
    expect((await readdir(join(dir, "ledger"))).sort()).toEqual(["session-1.json"])
  })
})
