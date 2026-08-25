import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readReflectionHealth } from "./health"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("reflection health", () => {
  describe("#given unordered completion files with a success followed by four failures and one corrupt record", () => {
    describe("#when health is derived", () => {
      test("#then counts pending streak and the dominant recent fingerprint are returned without throwing", async () => {
        // given
        const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
        roots.push(root)
        await mkdir(root, { recursive: true })
        const records = [
          completion("success", "2026-08-12T00:00:00.000Z", "merged"),
          completion("one", "2026-08-12T01:00:00.000Z", "failed", "child_exit", "same detail suffix one", true),
          completion("two", "2026-08-12T02:00:00.000Z", "failed", "child_exit", "same detail suffix one"),
          completion("three", "2026-08-12T03:00:00.000Z", "failed", "spawn_failed", "different"),
          completion("four", "2026-08-12T04:00:00.000Z", "failed", "child_exit", "same detail suffix one"),
          completion("timeout", "2026-08-11T23:00:00.000Z", "timed_out", "deadline_exceeded", "slow"),
        ]
        for (const record of records.reverse()) {
          await writeFile(join(root, `${record.runId}.json`), JSON.stringify(record))
        }
        await writeFile(join(root, "corrupt.json"), "{")

        // when
        const health = await readReflectionHealth(root, { now: Date.parse("2026-08-12T05:00:00.000Z") })

        // then
        expect(health).toEqual({
          streak: 4,
          fingerprint: "child_exit:same detail suffix one",
          lastFailure: {
            reason: "child_exit",
            detail: "same detail suffix one",
            finishedAt: "2026-08-12T04:00:00.000Z",
          },
          lastSuccessAt: "2026-08-12T00:00:00.000Z",
          lastOutcome: {
            runId: "four",
            outcome: "failed",
            reason: "child_exit",
            finishedAt: "2026-08-12T04:00:00.000Z",
          },
          counts: { merged: 1, no_changes: 0, failed: 4, timed_out: 1 },
          pendingCount: 1,
          recentFailureFingerprints: [
            "child_exit:same detail suffix one",
            "spawn_failed:different",
            "child_exit:same detail suffix one",
          ],
          streakSinceISO: "2026-08-12T01:00:00.000Z",
        })
      })
    })
  })

  test("#given a failure streak that would trip alerting #when health is derived #then the completions directory is left byte-identical", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    for (let index = 0; index < 3; index += 1) {
      const record = completion(`run-${index}`, `2026-08-12T0${index}:00:00.000Z`, "failed", "child_exit", "stable")
      await writeFile(join(root, `${record.runId}.json`), JSON.stringify(record))
    }
    const before = await snapshotDir(root)

    // when
    const health = await readReflectionHealth(root, { now: Date.parse("2026-08-12T05:00:00.000Z") })

    // then
    expect(health.streak).toBe(3)
    expect(await snapshotDir(root)).toEqual(before)
  })

  test("#given the read-only health module #when its source is inspected #then it imports no writer and calls no appendEntry or notify", async () => {
    // given
    const source = await readFile(new URL("./health.ts", import.meta.url), "utf8")

    // when
    const imports = [...source.matchAll(/^import[\s\S]*?from "(.+?)"$/gm)].map((match) => match[1])

    // then
    expect(imports).toEqual(["node:fs/promises", "node:path", "@oh-my-opencode/memory-core"])
    expect(source).not.toContain("appendEntry")
    expect(source).not.toContain("safeNotify")
    expect(source).not.toContain("writeFile")
    expect(source).not.toContain("mkdir")
    expect(source).not.toContain("rename")
    expect(source).not.toContain("rm(")
  })

  test("#given a success newer than every failure #when health is read #then the newest completion is reported as the last outcome", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    await writeFile(
      join(root, "older.json"),
      JSON.stringify(completion("older", "2026-08-12T01:00:00.000Z", "failed", "child_exit", "boom")),
    )
    await writeFile(
      join(root, "newest.json"),
      JSON.stringify(completion("newest", "2026-08-12T02:00:00.000Z", "merged")),
    )

    // when
    const health = await readReflectionHealth(root, { now: Date.parse("2026-08-12T05:00:00.000Z") })

    // then
    expect(health.lastOutcome).toEqual({
      runId: "newest",
      outcome: "merged",
      finishedAt: "2026-08-12T02:00:00.000Z",
    })
    expect(health.streak).toBe(0)
  })

  test("#given a missing directory #when health is read #then zeroed health is returned", async () => {
    // given
    const root = join(tmpdir(), `reflection-health-missing-${crypto.randomUUID()}`)

    // when
    const health = await readReflectionHealth(root)

    // then
    expect(health).toEqual({
      streak: 0,
      fingerprint: "",
      counts: { merged: 0, no_changes: 0, failed: 0, timed_out: 0 },
      pendingCount: 0,
      recentFailureFingerprints: [],
    })
  })
})

describe("reflection health recency", () => {
  test("#given a trailing failure streak whose newest failure is past the stale window #when health is derived #then the streak is zeroed and no fingerprint is reported", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    const now = Date.parse("2026-08-17T00:00:00.000Z")
    for (let index = 0; index < 3; index += 1) {
      const record = completion(`stale-${index}`, `2026-08-08T0${index}:00:00.000Z`, "failed", "child_exit", "stable")
      await writeFile(join(root, `stale-${index}.json`), JSON.stringify(record))
    }

    // when
    const health = await readReflectionHealth(root, { now })

    // then
    expect(health.streak).toBe(0)
    expect(health.fingerprint).toBe("")
    expect(health.recentFailureFingerprints).toEqual([])
    expect(health.streakSinceISO).toBeUndefined()
    expect(health.lastFailure?.finishedAt).toBe("2026-08-08T02:00:00.000Z")
    expect(health.counts.failed).toBe(3)
  })

  test("#given a streak whose newest failure sits exactly on the stale boundary #when health is derived #then the streak still counts", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    const now = Date.parse("2026-08-17T00:00:00.000Z")
    await writeFile(
      join(root, "edge.json"),
      JSON.stringify(completion("edge", "2026-08-10T00:00:00.000Z", "failed", "child_exit", "stable")),
    )
    await writeFile(
      join(root, "older.json"),
      JSON.stringify(completion("older", "2026-08-08T00:00:00.000Z", "failed", "child_exit", "stable")),
    )

    // when
    const health = await readReflectionHealth(root, { now })

    // then
    expect(health.streak).toBe(2)
  })

  test("#given a streak spanning the stale window with a fresh newest failure #when health is derived #then the whole streak counts", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    const now = Date.parse("2026-08-17T12:00:00.000Z")
    const records = [
      completion("fresh-1", "2026-08-17T11:00:00.000Z", "failed", "child_exit", "stable"),
      completion("fresh-2", "2026-08-17T10:00:00.000Z", "failed", "child_exit", "stable"),
      completion("old-1", "2026-08-08T10:00:00.000Z", "failed", "child_exit", "stable"),
      completion("old-2", "2026-08-08T09:00:00.000Z", "failed", "child_exit", "stable"),
    ]
    for (const record of records) {
      await writeFile(join(root, `${String(record.runId)}.json`), JSON.stringify(record))
    }

    // when
    const health = await readReflectionHealth(root, { now })

    // then
    expect(health.streak).toBe(4)
  })
})

async function snapshotDir(root: string): Promise<Record<string, string>> {
  const names = (await readdir(root)).sort()
  const snapshot: Record<string, string> = {}
  for (const name of names) snapshot[name] = await readFile(join(root, name), "utf8")
  return snapshot
}

function completion(
  runId: string,
  finishedAt: string,
  outcome: "merged" | "failed" | "timed_out",
  reason?: string,
  detail?: string,
  pending = false,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId,
    identity: "agent-test",
    category: "quick",
    conversationIds: ["past-session"],
    trigger: "manual",
    outcome,
    ...(reason === undefined ? {} : { reason }),
    ...(detail === undefined ? {} : { detail }),
    startedAt: finishedAt,
    finishedAt,
    delivery: { status: pending ? "pending" : "consumed" },
  }
}
