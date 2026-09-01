import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { collectReflection } from "../palace/collectors"
import {
  REFLECTION_COMPLETION_ENTRY_TYPE,
  REFLECTION_LAUNCHED_ENTRY_TYPE,
  REFLECTION_SUMMARY_ENTRY_TYPE,
  consumePendingReflectionCompletions,
  ensureReflectionCompletion,
  recordReflectionCompletion,
  reflectionLaunchedText,
  registerReflectionCompletionRenderer,
  type ReflectionCompletionRecord,
  type ReflectionLaunchedEntry,
} from "./completion"
import { CapturedCompletionApi } from "./runner.test-support"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "../teardown.test-support"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

const FIXED_NOW_MS = Date.parse("2026-08-16T12:00:00.000Z")
const FIXED_RECENT_TIMESTAMP = new Date(FIXED_NOW_MS - 60_000).toISOString()

function record(): ReflectionCompletionRecord {
  return {
    schemaVersion: 1,
    runId: "run-offline",
    identity: "agent-test",
    category: "quick",
    model: "omo-mock/mock-1",
    thinking: "high",
    conversationIds: ["conversation-a"],
    trigger: "dream",
    origin: "shutdown",
    outcome: "merged",
    startedAt: FIXED_RECENT_TIMESTAMP,
    finishedAt: FIXED_RECENT_TIMESTAMP,
    delivery: { status: "pending" },
  }
}

describe("reflection completion flow", () => {
  test("#given a reflection launch #when its entry renders #then run trigger and backlog are visible", () => {
    // given
    const launched: ReflectionLaunchedEntry = {
      schemaVersion: 1,
      runId: "run-launched",
      identity: "agent-test",
      trigger: "step-count",
      category: "quick",
      conversationIds: ["conversation-a"],
      backlogSteps: 14,
      startedAt: "2026-08-12T00:00:00.000Z",
    }

    // when
    const text = reflectionLaunchedText(launched)

    // then
    expect(text).toBe("memory reflection started run:run-launched trigger:step-count (+14 steps)")
  })

  test("#given a legacy completion without enrichment fields #when it renders #then backward compatibility is preserved", () => {
    // given
    const legacy = record()
    const api = new CapturedCompletionApi()
    registerReflectionCompletionRenderer(api)

    // when
    const renderer = api.renderers.find((item) => item.customType === REFLECTION_COMPLETION_ENTRY_TYPE)?.renderer

    // then
    expect(legacy.durationMs).toBeUndefined()
    expect(renderer).toBeDefined()
  })
  test("#given an existing consumed completion #when a retry ensures the same pending record #then consumed delivery is preserved", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
    roots.push(root)
    const api = new CapturedCompletionApi()
    await recordReflectionCompletion(root, record(), {
      sessionId: "conversation-a",
      api,
    })

    // when
    const ensured = await ensureReflectionCompletion(root, record())

    // then
    expect(ensured.delivery.status).toBe("consumed")
    expect(JSON.parse(await readFile(join(root, "run-offline.json"), "utf8"))).toEqual(ensured)
  })

  test("#given an existing completion with a different outcome #when ensured #then corruption is rejected without overwrite", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
    roots.push(root)
    await recordReflectionCompletion(root, record())
    const mismatched: ReflectionCompletionRecord = { ...record(), outcome: "failed" }

    // when
    const ensure = ensureReflectionCompletion(root, mismatched)

    // then
    await expect(ensure).rejects.toThrow("completion record mismatch")
    expect(JSON.parse(await readFile(join(root, "run-offline.json"), "utf8"))).toMatchObject({
      outcome: "merged",
    })
  })

  test("#given no live source session #when completion is recorded #then it remains durable and pending", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
    roots.push(root)

    // when
    const written = await recordReflectionCompletion(root, record())

    // then
    expect(written.delivery.status).toBe("pending")
    const persisted: unknown = JSON.parse(await readFile(join(root, "run-offline.json"), "utf8"))
    expect(persisted).toEqual(written)
    expect(persisted).toMatchObject({
      runId: "run-offline",
      trigger: "dream",
      origin: "shutdown",
      outcome: "merged",
      finishedAt: FIXED_RECENT_TIMESTAMP,
    })
  })

  test("#given a worker completion record #when the landed palace collector reads reflection outcomes #then runId outcome and finishedAt match its contract", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")
    await recordReflectionCompletion(join(paths.reflection, "completions"), record())

    // when
    const reflection = await collectReflection(paths, { limit: 5 })

    // then
    expect(reflection.outcomes).toEqual([{
      runId: "run-offline",
      outcome: "merged",
      finishedAt: FIXED_RECENT_TIMESTAMP,
    }])
  })

  test("#given a pending offline completion #when its source session starts #then appendEntry notify and consumed state happen without a model message", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
    roots.push(root)
    await recordReflectionCompletion(root, record())
    const api = new CapturedCompletionApi()
    const notifications: Array<{ message: string; level: string }> = []
    registerReflectionCompletionRenderer(api)

    // when
    const consumed = await consumePendingReflectionCompletions(root, "agent-test", {
      sessionId: "conversation-a",
      api,
      ui: { notify: (message, level) => notifications.push({ message, level }) },
    }, FIXED_NOW_MS)

    // then
    expect(consumed).toHaveLength(1)
    expect(api.renderers.map((item) => item.customType)).toEqual([
      "senpi-memory.reflection-completion",
      "senpi-memory.reflection-launched",
      "senpi-memory.reflection-summary",
    ])
    expect(api.entries).toEqual([{ customType: REFLECTION_COMPLETION_ENTRY_TYPE, data: consumed[0] }])
    expect(notifications).toHaveLength(1)
    expect(consumed[0]?.delivery).toMatchObject({ status: "consumed", sessionId: "conversation-a" })
  })

  describe("#given target foreign and missing-identity pending completions in one drained directory", () => {
    describe("#when the target identity drains the backlog", () => {
      test("#then only target records are delivered counted and consumed", async () => {
        // given
        const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
        roots.push(root)
        const now = FIXED_NOW_MS
        const targetRecords = Array.from({ length: 8 }, (_, index): ReflectionCompletionRecord => ({
          ...record(),
          runId: `target-${index}`,
          finishedAt: new Date(now - (index + 2) * 60_000).toISOString(),
        }))
        const foreignRecords = Array.from({ length: 2 }, (_, index): ReflectionCompletionRecord => ({
          ...record(),
          runId: `foreign-${index}`,
          identity: "agent-foreign",
          finishedAt: new Date(now - index * 60_000).toISOString(),
        }))
        for (const pending of [...targetRecords, ...foreignRecords]) await recordReflectionCompletion(root, pending)
        const { identity: _identity, ...missingIdentity } = {
          ...record(),
          runId: "missing-identity",
          finishedAt: new Date(now + 60_000).toISOString(),
        }
        await writeFile(join(root, "missing-identity.json"), `${JSON.stringify(missingIdentity, null, 2)}\n`)
        const api = new CapturedCompletionApi()

        // when
        await consumePendingReflectionCompletions(root, "agent-test", {
          sessionId: "target-session",
          api,
        }, now)

        // then
        expect(api.entries.filter((entry) => entry.customType === REFLECTION_COMPLETION_ENTRY_TYPE)).toHaveLength(5)
        expect(api.entries.filter((entry) => entry.customType === REFLECTION_COMPLETION_ENTRY_TYPE).map((entry) => entry.data)).toEqual(
          expect.arrayContaining(targetRecords.slice(0, 5).map((pending) => expect.objectContaining({ runId: pending.runId, identity: "agent-test" }))),
        )
        expect(api.entries.filter((entry) => entry.customType === REFLECTION_SUMMARY_ENTRY_TYPE)).toEqual([{
          customType: REFLECTION_SUMMARY_ENTRY_TYPE,
          data: expect.objectContaining({ count: 3 }),
        }])
        for (const pending of foreignRecords) {
          expect(JSON.parse(await readFile(join(root, `${pending.runId}.json`), "utf8"))).toMatchObject({
            identity: "agent-foreign",
            delivery: { status: "pending" },
          })
        }
        expect(JSON.parse(await readFile(join(root, "missing-identity.json"), "utf8"))).toMatchObject({
          runId: "missing-identity",
          delivery: { status: "pending" },
        })
      })
    })
  })

  describe("#given a throwing reflection UI", () => {
    describe("#when a pending completion is delivered", () => {
      test("#then the entry is consumed and the UI failure is logged", async () => {
        // given
        const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
        roots.push(root)
        await recordReflectionCompletion(root, record())
        const api = new CapturedCompletionApi()
        const warnings: unknown[] = []

        // when
        const consumed = await consumePendingReflectionCompletions(root, "agent-test", {
          sessionId: "different-session",
          api,
          ui: { notify: () => { throw new Error("ui unavailable") } },
          logger: { warn: (_message, details) => warnings.push(details) },
        }, FIXED_NOW_MS)

        // then
        expect(consumed[0]?.delivery.status).toBe("consumed")
        expect(api.entries).toHaveLength(1)
        expect(warnings).toHaveLength(1)
      })
    })
  })

  describe("#given eight pending completions for one identity including two older than seven days", () => {
    describe("#when a different session for that identity drains the backlog twice", () => {
      test("#then five details one summary and one notify are emitted once while stale records are silently consumed", async () => {
        // given
        const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-completion-")))
        roots.push(root)
        const now = FIXED_NOW_MS
        const records = Array.from({ length: 8 }, (_, index): ReflectionCompletionRecord => ({
          ...record(),
          runId: `run-${index}`,
          conversationIds: [`past-session-${index}`],
          outcome: index === 5 || index === 6 ? "failed" : "merged",
          ...(index === 5 || index === 6 ? { reason: "child_exit", detail: "same failure" } : {}),
          finishedAt: new Date(now - (index < 6 ? index * 60_000 : (8 + index) * 24 * 60 * 60_000)).toISOString(),
        }))
        for (const pending of records) await recordReflectionCompletion(root, pending)
        const api = new CapturedCompletionApi()
        const notifications: Array<{ message: string; level: string }> = []
        const live = {
          sessionId: "new-session",
          api,
          ui: { notify: (message: string, level: "info" | "warning" | "error") => notifications.push({ message, level }) },
        }

        // when
        const first = await consumePendingReflectionCompletions(root, "agent-test", live, now)
        const second = await consumePendingReflectionCompletions(root, "agent-test", live, now)

        // then
        expect(first).toHaveLength(8)
        expect(second).toEqual([])
        expect(api.entries.filter((entry) => entry.customType === REFLECTION_COMPLETION_ENTRY_TYPE)).toHaveLength(5)
        expect(api.entries.filter((entry) => entry.customType === REFLECTION_SUMMARY_ENTRY_TYPE)).toEqual([{
          customType: REFLECTION_SUMMARY_ENTRY_TYPE,
          data: expect.objectContaining({ schemaVersion: 1, count: 1, failedCount: 1 }),
        }])
        expect(notifications).toHaveLength(1)
        expect(notifications[0]?.level).toBe("warning")
        for (const pending of records) {
          expect(JSON.parse(await readFile(join(root, `${pending.runId}.json`), "utf8"))).toMatchObject({
            conversationIds: pending.conversationIds,
            delivery: { status: "consumed", sessionId: "new-session" },
          })
        }
      })
    })
  })
})
