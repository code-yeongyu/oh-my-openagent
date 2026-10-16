import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { REFLECTION_PARK_PROBE_INTERVAL_MS } from "@oh-my-opencode/memory-core"

import { emitReflectionParkAlert, REFLECTION_PARKED_ENTRY_TYPE, type ReflectionParkedEntry } from "./park-alert"
import { CapturedCompletionApi } from "./runner.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const PARKED_AT = "2026-09-15T06:00:00.000Z"

async function reflectionDir(park: Record<string, unknown> | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reflection-park-alert-"))
  roots.push(root)
  if (park !== undefined) await writeFile(join(root, "park.json"), `${JSON.stringify(park)}\n`)
  return root
}

function parkedState(): Record<string, unknown> {
  return {
    version: 1,
    streak: 3,
    firstFailureAt: "2026-09-15T05:50:00.000Z",
    parkedAt: PARKED_AT,
    lastFailure: {
      runId: "reflection-run-3",
      at: PARKED_AT,
      fingerprint: "spawn_failed:Error: Model \"x\" not found",
      retryable: false,
      reason: "spawn_failed",
      detail: 'Error: Model "x" not found. Use --list-models to see available models.',
    },
  }
}

function liveHarness(sessionId = "session-a") {
  const api = new CapturedCompletionApi()
  const notifications: string[] = []
  const seen = new Set<string>()
  return {
    api,
    notifications,
    live: { sessionId, api, ui: { notify: (message: string) => notifications.push(message) } },
    once: (key: string): boolean => {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
  }
}

describe("reflection park alert", () => {
  test("#given a parked identity and a live UI #when the alert is emitted twice in one session #then one entry and one warning appear", async () => {
    // given
    const dir = await reflectionDir(parkedState())
    const harness = liveHarness()

    // when
    const first = await emitReflectionParkAlert(dir, "agent-test", harness.live, harness.once)
    const second = await emitReflectionParkAlert(dir, "agent-test", harness.live, harness.once)

    // then
    expect(first).toBe(true)
    expect(second).toBe(false)
    const entries = harness.api.entries.filter((entry) => entry.customType === REFLECTION_PARKED_ENTRY_TYPE)
    expect(entries).toHaveLength(1)
    expect(harness.notifications).toHaveLength(1)
    const entry = entries[0]?.data as ReflectionParkedEntry
    expect(entry).toMatchObject({
      schemaVersion: 1,
      identity: "agent-test",
      streak: 3,
      parkedAt: PARKED_AT,
      nextProbeAt: new Date(Date.parse(PARKED_AT) + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString(),
      retryable: false,
      lastReason: "spawn_failed",
    })
    expect(harness.notifications[0]).toContain("/reflect")
  })

  test("#given an identity that is not parked #when the alert is emitted #then nothing is appended", async () => {
    // given
    const dir = await reflectionDir({ version: 1, streak: 2 })
    const harness = liveHarness()

    // when
    const emitted = await emitReflectionParkAlert(dir, "agent-test", harness.live, harness.once)

    // then
    expect(emitted).toBe(false)
    expect(harness.api.entries).toHaveLength(0)
  })

  test("#given no park file #when the alert is emitted #then nothing is appended", async () => {
    // given
    const dir = await reflectionDir(undefined)
    const harness = liveHarness()

    // then
    expect(await emitReflectionParkAlert(dir, "agent-test", harness.live, harness.once)).toBe(false)
  })

  test("#given a parked identity #when a second session binds #then it is told once as well", async () => {
    // given
    const dir = await reflectionDir(parkedState())
    const first = liveHarness("session-a")
    const second = liveHarness("session-b")

    // when
    await emitReflectionParkAlert(dir, "agent-test", first.live, first.once)
    const told = await emitReflectionParkAlert(dir, "agent-test", second.live, second.once)

    // then
    expect(told).toBe(true)
    expect(second.notifications).toHaveLength(1)
  })
})
