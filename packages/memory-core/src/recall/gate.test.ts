import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PendingNudges, parseNudgeLines, validateNudges } from "./gate"

const tempDirs: string[] = []

async function createPendingDir(): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "recall-pending-")))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

describe("parseNudgeLines", () => {
  it("#given well-formed NDJSON #when parsed #then every nudge is returned in order", () => {
    // given
    const raw = `{"path":"reference/a.md","hint":"alpha"}\n{"path":"notes/b.md","hint":"beta"}\n`

    // when
    const nudges = parseNudgeLines(raw)

    // then
    expect(nudges).toEqual([
      { path: "reference/a.md", hint: "alpha" },
      { path: "notes/b.md", hint: "beta" },
    ])
  })

  it("#given malformed and non-conforming lines #when parsed #then only valid lines survive", () => {
    // given
    const raw = [
      "{not json",
      `{"path":"reference/a.md","hint":"alpha"}`,
      `{"path":"reference/c.md"}`,
      `{"hint":"orphan"}`,
      `["reference/d.md","hint"]`,
      `{"path":"","hint":"empty"}`,
      `{"path":"reference/e.md","hint":""}`,
      "   ",
      `{"path":"notes/b.md","hint":"beta","extra":1}`,
    ].join("\n")

    // when
    const nudges = parseNudgeLines(raw)

    // then
    expect(nudges).toEqual([
      { path: "reference/a.md", hint: "alpha" },
      { path: "notes/b.md", hint: "beta" },
    ])
  })

  it("#given empty output #when parsed #then the result is empty", () => {
    // given / when / then
    expect(parseNudgeLines("")).toEqual([])
    expect(parseNudgeLines("\n\n")).toEqual([])
  })
})

describe("validateNudges", () => {
  const candidates = new Set(["reference/a.md", "notes/b.md", "reference/c.md"])

  it("#given a path outside the candidate set #when validated #then it is rejected", () => {
    // given / when
    const accepted = validateNudges(
      [
        { path: "reference/unknown.md", hint: "stranger" },
        { path: "reference/a.md", hint: "alpha" },
      ],
      { candidates, surfaced: new Set(), maxItems: 5 },
    )

    // then
    expect(accepted).toEqual([{ path: "reference/a.md", hint: "alpha" }])
  })

  it("#given an already surfaced path #when validated #then it is rejected", () => {
    // given / when
    const accepted = validateNudges(
      [{ path: "notes/b.md", hint: "beta" }],
      { candidates, surfaced: new Set(["notes/b.md"]), maxItems: 5 },
    )

    // then
    expect(accepted).toEqual([])
  })

  it("#given an oversized or multiline hint #when validated #then it is rejected", () => {
    // given
    const long = "x".repeat(201)

    // when
    const accepted = validateNudges(
      [
        { path: "reference/a.md", hint: long },
        { path: "notes/b.md", hint: "line one\nline two" },
        { path: "reference/c.md", hint: "y".repeat(200) },
      ],
      { candidates, surfaced: new Set(), maxItems: 5 },
    )

    // then
    expect(accepted).toEqual([{ path: "reference/c.md", hint: "y".repeat(200) }])
  })

  it("#given more nudges than maxItems #when validated #then the cap is enforced in order", () => {
    // given / when
    const accepted = validateNudges(
      [
        { path: "reference/a.md", hint: "alpha" },
        { path: "notes/b.md", hint: "beta" },
        { path: "reference/c.md", hint: "gamma" },
      ],
      { candidates, surfaced: new Set(), maxItems: 2 },
    )

    // then
    expect(accepted).toEqual([
      { path: "reference/a.md", hint: "alpha" },
      { path: "notes/b.md", hint: "beta" },
    ])
  })

  it("#given a repeated path in one batch #when validated #then only the first occurrence survives", () => {
    // given / when
    const accepted = validateNudges(
      [
        { path: "reference/a.md", hint: "alpha" },
        { path: "reference/a.md", hint: "alpha again" },
      ],
      { candidates, surfaced: new Set(), maxItems: 5 },
    )

    // then
    expect(accepted).toEqual([{ path: "reference/a.md", hint: "alpha" }])
  })
})

describe("PendingNudges", () => {
  it("#given written nudges #when taken #then they return once and the file is gone", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })

    // when
    const first = await store.take("session-1", { currentEpoch: 0 })
    const second = await store.take("session-1", { currentEpoch: 0 })

    // then
    expect(first).toEqual([{ path: "reference/a.md", hint: "alpha" }])
    expect(second).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it("#given a written file #when inspected #then the self-describing payload and mode are pinned", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)

    // when
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })

    // then
    const filePath = join(dir, "session-1.json")
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      version: number
      sessionId: string
      compactionEpoch: number
      writtenAt: string
      nudges: { path: string; hint: string }[]
    }
    expect(parsed.version).toBe(1)
    expect(parsed.sessionId).toBe("session-1")
    expect(parsed.compactionEpoch).toBe(0)
    expect(parsed.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(parsed.nudges).toEqual([{ path: "reference/a.md", hint: "alpha" }])
    if (process.platform !== "win32") {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
  })

  it("#given a payload written for another session #when taken #then nothing returns and the file survives", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await writeFile(
      join(dir, "session-1.json"),
      `${JSON.stringify({
        version: 1,
        sessionId: "session-2",
        compactionEpoch: 0,
        writtenAt: new Date().toISOString(),
        nudges: [{ path: "reference/a.md", hint: "alpha" }],
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    )

    // when
    const taken = await store.take("session-1", { currentEpoch: 0 })

    // then
    expect(taken).toEqual([])
    expect(await readdir(dir)).toEqual(["session-1.json"])
  })

  it("#given a payload written 25 hours ago #when taken #then nothing returns and the file is deleted", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    const stale = new Date(Date.now() - 25 * 60 * 60_000).toISOString()
    await writeFile(
      join(dir, "session-1.json"),
      `${JSON.stringify({
        version: 1,
        sessionId: "session-1",
        compactionEpoch: 0,
        writtenAt: stale,
        nudges: [{ path: "reference/a.md", hint: "alpha" }],
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    )

    // when
    const taken = await store.take("session-1", { currentEpoch: 0 })

    // then
    expect(taken).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it("#given a malformed or unknown-version file #when taken #then nothing returns and nothing throws", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await writeFile(join(dir, "session-1.json"), "{not json", "utf8")
    await writeFile(
      join(dir, "session-2.json"),
      JSON.stringify({ version: 99, sessionId: "session-2", writtenAt: new Date().toISOString(), nudges: [] }),
      "utf8",
    )

    // when / then
    expect(await store.take("session-1", { currentEpoch: 0 })).toEqual([])
    expect(await store.take("session-2", { currentEpoch: 0 })).toEqual([])
    expect(await store.take("never-written", { currentEpoch: 0 })).toEqual([])
  })

  it("#given stale siblings and tmp orphans #when a new payload is written #then only fresh files remain", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    const stalePath = join(dir, "old-session.json")
    const orphanPath = join(dir, "session-9.json.tmp-4242")
    const freshPath = join(dir, "fresh-session.json")
    await writeFile(stalePath, JSON.stringify({ version: 1, sessionId: "old-session", writtenAt: "x", nudges: [] }), "utf8")
    await writeFile(orphanPath, "{}", "utf8")
    await writeFile(freshPath, JSON.stringify({ version: 1, sessionId: "fresh-session", writtenAt: "y", nudges: [] }), "utf8")
    const old = new Date(Date.now() - 25 * 60 * 60_000)
    await utimes(stalePath, old, old)
    await utimes(orphanPath, old, old)

    // when
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })

    // then
    expect((await readdir(dir)).sort()).toEqual(["fresh-session.json", "session-1.json"])
  })

  it("#given an unsafe session id #when written and taken #then the file stays inside the pending dir", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)

    // when
    await store.write("a:b?c", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })

    // then
    const names = await readdir(dir)
    expect(names).toHaveLength(1)
    expect(names[0]).not.toMatch(/[:\\/?*]/)
    expect(await store.take("a:b?c", { currentEpoch: 0 })).toEqual([{ path: "reference/a.md", hint: "alpha" }])
  })

  it("#given a written payload #when deleted #then only that session's file is removed", async () => {
    // given: the gate writer retracts its OWN just-written payload
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })
    await store.write("session-2", [{ path: "reference/b.md", hint: "beta" }], { epoch: 0 })

    // when
    await store.delete("session-1")

    // then
    expect(await readdir(dir)).toEqual(["session-2.json"])
    expect(await store.take("session-2", { currentEpoch: 0 })).toEqual([{ path: "reference/b.md", hint: "beta" }])
  })

  it("#given no payload for the session #when deleted #then it is a silent no-op", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)

    // when / then: retraction must never throw on the write path it guards
    await store.delete("session-1")
    expect(await readdir(dir)).toEqual([])
  })

  it("#given no nudges #when written #then nothing is stored", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)

    // when
    await store.write("session-1", [], { epoch: 0 })

    // then
    expect(await readdir(dir)).toEqual([])
    expect(await store.take("session-1", { currentEpoch: 0 })).toEqual([])
  })

  it("#given a colliding filename owned by another session #when deleted #then the file survives", async () => {
    // given: "a:b" and "a/b" sanitize to the same filename, so an unguarded unlink would let one
    // session retract the other session's payload
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await store.write("a:b", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 0 })
    const namesBefore = await readdir(dir)

    // when
    await store.delete("a/b")

    // then
    expect(await readdir(dir)).toEqual(namesBefore)
    expect(await store.take("a:b", { currentEpoch: 0 })).toEqual([{ path: "reference/a.md", hint: "alpha" }])
  })
})

describe("PendingNudges compaction epoch", () => {
  it("#given a payload stamped with an older epoch #when taken at the bumped epoch #then nothing returns and the file is deleted", async () => {
    // given: a compaction landed after the payload was written, so its transcript no longer exists
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 7 })

    // when
    const taken = await store.take("session-1", { currentEpoch: 8 })

    // then
    expect(taken).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it("#given a payload stamped with the live epoch #when taken #then the nudges are returned", async () => {
    // given
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await store.write("session-1", [{ path: "reference/a.md", hint: "alpha" }], { epoch: 7 })

    // when
    const taken = await store.take("session-1", { currentEpoch: 7 })

    // then
    expect(taken).toEqual([{ path: "reference/a.md", hint: "alpha" }])
    expect(await readdir(dir)).toEqual([])
  })

  it("#given a payload carrying no epoch #when taken #then it is treated as stale and deleted", async () => {
    // given: the epoch-less shape predates the field and can only come from a pre-release write
    const dir = await createPendingDir()
    const store = new PendingNudges(dir)
    await writeFile(
      join(dir, "session-1.json"),
      `${JSON.stringify({
        version: 1,
        sessionId: "session-1",
        writtenAt: new Date().toISOString(),
        nudges: [{ path: "reference/a.md", hint: "alpha" }],
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    )

    // when
    const taken = await store.take("session-1", { currentEpoch: 0 })

    // then
    expect(taken).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })
})
