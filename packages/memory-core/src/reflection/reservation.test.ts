import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildIdentityPaths, type MemoryIdentity } from "../identity"
import { TranscriptJournal, type ReflectionSnapshot } from "../journal"
import { ReflectionReservationStore } from "./reservation"
import type { ReflectionRequest } from "./machine"
import { realpathSync } from "node:fs"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function fixture(stepCount = 2) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-reservation-")))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const journals = new Map<string, TranscriptJournal>()
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a") })
  journals.set("conversation-a", journal)
  await journal.reconcile([
    { kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] },
    { kind: "assistant", messageId: "assistant-2", textBlocks: ["two"] },
  ])
  let nextId = 0
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount, onCompaction: true },
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    launcherIdentity: async () => ({ pid: 4242, hostname: "fixture-host", processStart: "fixture-start" }),
    getJournal: async (id) => {
      const found = journals.get(id)
      if (!found) throw new Error(`missing journal: ${id}`)
      return found
    },
    createRunId: () => `run-${++nextId}`,
  })
  return { identity, journal, store }
}

async function captured(
  journal: TranscriptJournal,
  trigger: Exclude<ReflectionRequest["trigger"], "dream">,
): Promise<ReflectionRequest> {
  const snapshot = await journal.captureReflectionSnapshot()
  if (snapshot === null) throw new Error("expected snapshot")
  return { trigger, conversationIds: ["conversation-a"], snapshots: [{ conversationId: "conversation-a", snapshot }] }
}

describe("persisted reflection reservation", () => {
  it("#given an aborted signal #when reservation starts #then active and pending state remain empty", async () => {
    // given
    const { store } = await fixture()
    const controller = new AbortController()
    controller.abort()

    // when
    const reservation = store.tryReserve({
      trigger: "step-count",
      conversationIds: ["conversation-a"],
      snapshots: [],
    }, controller.signal)

    // then
    await expect(reservation).rejects.toThrow()
    expect(await store.readState()).toEqual({})
  })

  it("#given journal state at threshold #when the persisted machine evaluates a successful settle #then it captures and reserves the cursor snapshot", async () => {
    const { store } = await fixture()

    const result = await store.evaluate("conversation-a", { kind: "settled", success: true })

    expect(result?.status).toBe("active")
    expect(result?.run.request.trigger).toBe("step-count")
    expect(result?.run.request.snapshots[0]?.snapshot.end_message_id).toBe("assistant-2")
  })

  it("#given a new active reservation #when it is published #then launch-owner identity and reservation time are durable in the same record", async () => {
    const { identity, journal, store } = await fixture()

    const result = await store.tryReserve(await captured(journal, "step-count"))
    const persisted = JSON.parse(await readFile(join(identity.paths.reflection, "active.lock"), "utf8"))

    expect(result.run).toMatchObject({
      reservedAt: "2026-08-10T00:00:00.000Z",
      launcherPid: 4242,
      launcherHostname: "fixture-host",
      launcherProcessStart: "fixture-start",
    })
    expect(persisted).toMatchObject(result.run)
  })

  it("#given simultaneous trigger requests #when reserved #then one becomes active and all others collapse into one atomic pending record", async () => {
    const { identity, journal, store } = await fixture()
    const base = await captured(journal, "step-count")
    const first = await store.tryReserve(base)
    const [second, third] = await Promise.all([
      store.tryReserve({ ...base, trigger: "compaction", conversationIds: ["conversation-c"] }),
      store.tryReserve({ ...base, trigger: "manual", conversationIds: ["conversation-b"], focus: "remember names", recentN: 5 }),
    ])
    const state = await store.readState()
    expect(first.status).toBe("active")
    expect(second.status).toBe("pending")
    expect(third.status).toBe("pending")
    expect(state.active).toBeDefined()
    expect(state.pending?.request).toMatchObject({ trigger: "manual", focus: "remember names", recentN: 5 })
    expect(await readFile(join(identity.paths.reflection, "pending.json"), "utf8")).toContain('"trigger": "manual"')
  })

  it("#given dream outcomes #when runs complete #then dream state advances only for merged and no_changes", async () => {
    const { identity, store } = await fixture()
    const outcomes = ["failed", "timed_out", "merged", "no_changes"] as const

    for (const outcome of outcomes) {
      const active = await store.tryReserve({
        trigger: "dream",
        origin: "idle",
        conversationIds: ["conversation-a"],
        snapshots: [],
      })
      await store.complete(active.run.runId, outcome)
      const statePath = join(identity.paths.runtime, "dream", "state.json")
      if (outcome === "failed" || outcome === "timed_out") {
        expect(Bun.file(statePath).size).toBe(0)
      } else {
        expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
          last_dream_at: "2026-08-10T00:00:00.000Z",
          lastRunId: active.run.runId,
        })
      }
    }
  })

  it("#given a failed active run #when completed #then its cursor is unchanged and valid pending work is promoted", async () => {
    const { journal, store } = await fixture()
    const request = await captured(journal, "step-count")
    const active = await store.tryReserve(request)
    const pending = await store.tryReserve({ ...request, trigger: "manual", focus: "retry manually" })

    const completion = await store.complete(active.run.runId, "failed")
    const state = await journal.getState()

    expect(pending.status).toBe("pending")
    expect(state.reflected_completed_steps).toBe(0)
    expect(completion.launch?.runId).toBe(pending.run.runId)
    expect((await store.readState()).active?.runId).toBe(pending.run.runId)
  })

  it("#given successful compaction-triggered work #when completed #then its snapshot advances and the compaction flag clears exactly once", async () => {
    const { journal, store } = await fixture()
    await journal.setPendingCompaction(true)
    const active = await store.tryReserve(await captured(journal, "compaction"))

    const completion = await store.complete(active.run.runId, "merged")
    const state = await journal.getState()

    expect(completion.launch).toBeUndefined()
    expect(state.reflected_completed_steps).toBe(2)
    expect(state.pending_compaction).toBe(false)
    expect((await store.readState()).active).toBeUndefined()
  })

  it("#given a pending threshold request made stale by successful cursor advancement #when dequeued #then it is dropped", async () => {
    const { journal, store } = await fixture()
    const request = await captured(journal, "step-count")
    const active = await store.tryReserve(request)
    await store.tryReserve(request)

    const completion = await store.complete(active.run.runId, "merged")

    expect(completion.launch).toBeUndefined()
    expect((await journal.getState()).steps_since_last_successful_reflection).toBe(0)
    expect((await store.readState()).active).toBeUndefined()
  })

  it("#given automatic pending work below its threshold #when dequeued #then it is dropped but a manual pending request remains launchable", async () => {
    const { journal, store } = await fixture(3)
    const snapshot: ReflectionSnapshot = {
      start_message_id: "a",
      end_message_id: "b",
      start_line: 0,
      end_snapshot_line: 0,
      entries: [],
    }
    const active = await store.tryReserve({ trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] })
    await store.tryReserve({ trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [{ conversationId: "conversation-a", snapshot }] })
    expect((await store.complete(active.run.runId, "failed")).launch).toBeUndefined()

    const next = await store.tryReserve({ trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] })
    const manual = await store.tryReserve({ trigger: "manual", conversationIds: ["conversation-a"], snapshots: [], focus: "always" })
    expect((await store.complete(next.run.runId, "failed")).launch?.runId).toBe(manual.run.runId)
    expect((await journal.getState()).reflected_completed_steps).toBe(0)
  })
})
