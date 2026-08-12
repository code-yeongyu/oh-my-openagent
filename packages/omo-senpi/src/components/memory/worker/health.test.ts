import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { emitReflectionHealthAlert, readReflectionHealth, REFLECTION_HEALTH_ENTRY_TYPE } from "./health"
import { CapturedCompletionApi } from "./runner.test-support"

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
        const health = await readReflectionHealth(root)

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

  test("#given three stable failures and a live UI #when health alerting repeats in one session #then one entry and one warning are emitted", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-health-"))
    roots.push(root)
    for (let index = 0; index < 3; index += 1) {
      const record = completion(`run-${index}`, `2026-08-12T0${index}:00:00.000Z`, "failed", "child_exit", "stable")
      await writeFile(join(root, `${record.runId}.json`), JSON.stringify(record))
    }
    const api = new CapturedCompletionApi()
    const notifications: string[] = []
    const seen = new Set<string>()
    const live = {
      sessionId: "session-a",
      api,
      ui: { notify: (message: string) => notifications.push(message) },
    }

    // when
    await emitReflectionHealthAlert(root, "agent-test", live, (key) => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    await emitReflectionHealthAlert(root, "agent-test", live, (key) => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // then
    expect(api.entries.filter((entry) => entry.customType === REFLECTION_HEALTH_ENTRY_TYPE)).toHaveLength(1)
    expect(notifications).toHaveLength(1)
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
    const health = await readReflectionHealth(root)

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
