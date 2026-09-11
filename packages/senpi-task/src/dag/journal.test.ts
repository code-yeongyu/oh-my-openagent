// allow: SIZE_OK - the journal acceptance matrix keeps durability, replay, and subscriber backpressure invariants together.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  dagDefinitionAmendedEvent,
  dagNodeRetriedEvent,
  dagNodeSteeredEvent,
  dagNodeTransitionedEvent,
  dagRunStartedEvent,
} from "./events"
import { createDagJournal, subscribeDagJournal, type DagJournalCheckpoint } from "./journal"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunEvent, DagRunId } from "./types"

const cleanupRoots: string[] = []
const runId = "run-journal" as DagRunId

interface TestCheckpoint extends DagJournalCheckpoint {
  readonly runId: DagRunId
  readonly generations: readonly number[]
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-journal-"))
  cleanupRoots.push(directory)
  return directory
}

function initialCheckpoint(): TestCheckpoint {
  return { schemaVersion: 1, runId, checkpointSeq: 0, generations: [] }
}

function applyEvent(checkpoint: TestCheckpoint, event: DagRunEvent): TestCheckpoint {
  return event.type === "dag.run.started"
    ? { ...checkpoint, generations: [...checkpoint.generations, event.generation] }
    : checkpoint
}

interface ReplayCheckpoint extends DagJournalCheckpoint {
  readonly runId: DagRunId
  readonly generations: readonly number[]
  readonly retried: readonly DagNodeId[]
  readonly steered: readonly DagNodeId[]
  readonly amendCount: number
  readonly lastFingerprint?: string
}

function initialReplayCheckpoint(): ReplayCheckpoint {
  return {
    schemaVersion: 1,
    runId,
    checkpointSeq: 0,
    generations: [],
    retried: [],
    steered: [],
    amendCount: 0,
  }
}

function applyReplayEvent(checkpoint: ReplayCheckpoint, event: DagRunEvent): ReplayCheckpoint {
  switch (event.type) {
    case "dag.run.started":
      return { ...checkpoint, generations: [...checkpoint.generations, event.generation] }
    case "dag.node.retried":
      return { ...checkpoint, retried: [...checkpoint.retried, event.nodeId] }
    case "dag.node.steered":
      return { ...checkpoint, steered: [...checkpoint.steered, event.nodeId] }
    case "dag.definition.amended":
      return { ...checkpoint, amendCount: checkpoint.amendCount + 1, lastFingerprint: event.fingerprint }
    default:
      return checkpoint
  }
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function nextMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
}

describe("createDagJournal WAL ordering and replay", () => {
  test("#given three mutations #when appended #then subscribers see durable events in order and checkpoint seq reaches three", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const delivered: number[] = []
    const durableAtDelivery: number[] = []
    journal.subscribe((event) => {
      delivered.push(event.seq)
      durableAtDelivery.push(store.readCheckpoint<TestCheckpoint>(runId)?.checkpointSeq ?? -1)
    })

    // when
    journal.append(dagRunStartedEvent({ generation: 1 }))
    journal.append(dagRunStartedEvent({ generation: 2 }))
    journal.append(dagRunStartedEvent({ generation: 3 }))
    await journal.whenIdle()

    // then
    expect(delivered).toEqual([1, 2, 3])
    expect(durableAtDelivery).toEqual([3, 3, 3])
    expect(store.readCheckpoint<TestCheckpoint>(runId)).toEqual({
      schemaVersion: 1,
      runId,
      checkpointSeq: 3,
      generations: [1, 2, 3],
    })
  })

  test("#given checkpoint replacement crashes after WAL append #when reopened on the same store #then replay never reaches the previous journal subscriber", async () => {
    // given
    const project = tempProject()
    const durableStore = createDagFileStore({ project_dir: project })
    let failOnce = true
    const crashingStore: DagFileStore = {
      ...durableStore,
      writeCheckpoint(id, checkpoint) {
        if (failOnce) {
          failOnce = false
          throw new Error("injected checkpoint crash")
        }
        durableStore.writeCheckpoint(id, checkpoint)
      },
    }
    const crashing = createDagJournal({
      store: crashingStore,
      runId,
      initialCheckpoint: initialCheckpoint(),
      applyEvent,
    })
    const deliveredBeforeDurability: DagRunEvent[] = []
    crashing.subscribe((event) => {
      deliveredBeforeDurability.push(event)
    })

    // when
    expect(() => crashing.append(dagRunStartedEvent({ generation: 1 }))).toThrow("injected checkpoint crash")
    await nextMicrotask()
    const reopenedStore = crashingStore
    const reopened = createDagJournal({
      store: reopenedStore,
      runId,
      initialCheckpoint: initialCheckpoint(),
      applyEvent,
    })
    const deliveredAfterReopen: number[] = []
    reopened.subscribe((event) => {
      deliveredAfterReopen.push(event.seq)
    })
    const second = reopened.append(dagRunStartedEvent({ generation: 2 }))
    await nextMicrotask()

    // then
    expect(deliveredBeforeDurability).toEqual([])
    expect(second?.seq).toBe(2)
    expect(deliveredAfterReopen).toEqual([2])
    expect(reopened.snapshot()).toEqual({
      schemaVersion: 1,
      runId,
      checkpointSeq: 2,
      generations: [1, 2],
    })
    expect(reopenedStore.readEvents(runId, 0, { limit: 10 }).events.map((event) => event.seq)).toEqual([1, 2])
  })

  test("#given a queued node transition #when appended #then the journal preserves its queue position", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const nodeId = "node-a" as DagNodeId

    // when
    journal.append(dagNodeTransitionedEvent({
      nodeId,
      from: "scheduled",
      to: "scheduled",
      reason: { kind: "task_queued", queuePosition: 3 },
    }))

    // then
    expect(store.readEvents(runId, 0, { limit: 10 }).events).toContainEqual(expect.objectContaining({
      type: "dag.node.transitioned",
      nodeId,
      reason: { kind: "task_queued", queuePosition: 3 },
    }))
  })

  test("#given a durable checkpoint and WAL #when reopened #then sequence numbers continue from the greater persisted tail", () => {
    // given
    const project = tempProject()
    const firstStore = createDagFileStore({ project_dir: project })
    const first = createDagJournal({ store: firstStore, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    first.append(dagRunStartedEvent({ generation: 1 }))
    first.append(dagRunStartedEvent({ generation: 2 }))

    // when
    const reopenedStore = createDagFileStore({ project_dir: project })
    const reopened = createDagJournal({
      store: reopenedStore,
      runId,
      initialCheckpoint: initialCheckpoint(),
      applyEvent,
    })
    const event = reopened.append(dagRunStartedEvent({ generation: 3 }))

    // then
    expect(event?.seq).toBe(3)
    expect(reopened.snapshot().checkpointSeq).toBe(3)
  })
})

describe("createDagJournal subscribers", () => {
  test("#given a durable commit subscription #when it is removed before another journal commits #then no phantom delivery remains", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const first = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const reopened = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const delivered: number[] = []
    const unsubscribe = subscribeDagJournal(store, runId, (event) => {
      delivered.push(event.seq)
    })

    // when
    unsubscribe()
    reopened.append(dagRunStartedEvent({ generation: 1 }))
    await nextMicrotask()

    // then
    expect(delivered).toEqual([])
    expect(first.snapshot().checkpointSeq).toBe(0)
  })

  test("#given a subscriber blocked on its first event #when its ring overflows #then it receives one coalesced overflow with the last delivered recovery seq", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({
      store,
      runId,
      initialCheckpoint: initialCheckpoint(),
      applyEvent,
      subscriberRing: 2,
    })
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const delivered: DagRunEvent[] = []
    journal.subscribe(async (event) => {
      delivered.push(event)
      if (event.seq === 1 && event.type === "dag.run.started") {
        firstStarted.resolve()
        await releaseFirst.promise
      }
    })
    journal.append(dagRunStartedEvent({ generation: 1 }))
    await firstStarted.promise

    // when
    journal.append(dagRunStartedEvent({ generation: 2 }))
    journal.append(dagRunStartedEvent({ generation: 3 }))
    journal.append(dagRunStartedEvent({ generation: 4 }))
    journal.append(dagRunStartedEvent({ generation: 5 }))
    releaseFirst.resolve()
    await journal.whenIdle()

    // then
    expect(delivered.map((event) => event.type)).toEqual([
      "dag.run.started",
      "dag.stream.overflow",
      "dag.run.started",
      "dag.run.started",
    ])
    expect(delivered[1]).toMatchObject({
      type: "dag.stream.overflow",
      droppedCount: 2,
      recoverAfterSeq: 1,
    })
    expect(delivered.slice(2).map((event) => event.seq)).toEqual([4, 5])
  })

  test("#given a viewer recovering a subscriber overflow #when it catches up from the recovery cursor #then every WAL seq is applied once without gaps", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({
      store,
      runId,
      initialCheckpoint: initialCheckpoint(),
      applyEvent,
      subscriberRing: 2,
    })
    const releaseFirst = deferred()
    const firstStarted = deferred()
    const applied = new Map<number, DagRunEvent>()
    let lastApplied = 0
    const applyOnce = (event: DagRunEvent): void => {
      if (applied.has(event.seq)) return
      applied.set(event.seq, event)
      lastApplied = event.seq
    }
    journal.subscribe(async (event) => {
      if (event.type === "dag.stream.overflow") {
        const recovery = store.readEvents(runId, event.recoverAfterSeq, {
          limit: 100,
          throughSeq: event.seq,
        })
        for (const recovered of recovery.events) applyOnce(recovered)
        return
      }
      applyOnce(event)
      if (event.seq === 1) {
        firstStarted.resolve()
        await releaseFirst.promise
      }
    })
    journal.append(dagRunStartedEvent({ generation: 1 }))
    await firstStarted.promise

    // when
    journal.append(dagRunStartedEvent({ generation: 2 }))
    journal.append(dagRunStartedEvent({ generation: 3 }))
    journal.append(dagRunStartedEvent({ generation: 4 }))
    journal.append(dagRunStartedEvent({ generation: 5 }))
    releaseFirst.resolve()
    await journal.whenIdle()

    // then
    const wal = store.readEvents(runId, 0, { limit: 100 }).events
    expect(wal.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(wal.map((event) => event.seq)).size).toBe(wal.length)
    expect(wal.at(-1)).toMatchObject({
      seq: 6,
      type: "dag.stream.overflow",
      droppedCount: 2,
      recoverAfterSeq: 1,
    })
    expect([...applied.keys()]).toEqual([1, 2, 3, 4, 5, 6])
    expect(lastApplied).toBe(6)
  })

  test("#given a slow async listener #when another mutation is appended #then the mutation completes before the listener catches up", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const release = deferred()
    const listenerStarted = deferred()
    journal.subscribe(async () => {
      listenerStarted.resolve()
      await release.promise
    })
    journal.append(dagRunStartedEvent({ generation: 1 }))
    await listenerStarted.promise

    // when
    const second = journal.append(dagRunStartedEvent({ generation: 2 }))

    // then
    expect(second?.seq).toBe(2)
    expect(journal.snapshot().checkpointSeq).toBe(2)
    release.resolve()
    await journal.whenIdle()
  })

  test("#given an active subscription #when it is removed #then later events are not delivered", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const delivered: number[] = []
    const unsubscribe = journal.subscribe((event) => {
      delivered.push(event.seq)
    })
    journal.append(dagRunStartedEvent({ generation: 1 }))
    await journal.whenIdle()

    // when
    unsubscribe()
    journal.append(dagRunStartedEvent({ generation: 2 }))
    await nextMicrotask()

    // then
    expect(delivered).toEqual([1])
  })
})

describe("createDagJournal new event replay", () => {
  test("#given a WAL with dag.node.retried, dag.node.steered, and dag.definition.amended #when the checkpoint is rebuilt from the WAL #then replayed checkpoint equals the original", () => {
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({
      store,
      runId,
      initialCheckpoint: initialReplayCheckpoint(),
      applyEvent: applyReplayEvent,
    })
    const nodeA = "node-a" as DagNodeId
    const nodeB = "node-b" as DagNodeId

    journal.append(dagRunStartedEvent({ generation: 1 }))
    journal.append(dagNodeRetriedEvent({ nodeId: nodeA, execAttempt: 1, promptChanged: false }))
    journal.append(dagNodeSteeredEvent({ nodeId: nodeB, taskId: "task-b", delivery: "steer" }))
    journal.append(dagDefinitionAmendedEvent({
      previousFingerprint: "fp-old",
      fingerprint: "fp-new",
      changedNodeIds: [nodeA],
      addedNodeIds: [],
      invalidatedNodeIds: [nodeB],
    }))
    journal.append(dagRunStartedEvent({ generation: 2 }))

    const expected = journal.snapshot()
    const wal = store.readEvents(runId, 0, { limit: 100 }).events
    expect(wal.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(wal.map((event) => event.seq)).size).toBe(wal.length)
    expect(wal.every((event) => event.lane === "boundary")).toBe(true)

    fs.unlinkSync(store.paths.run(runId))

    const replayed = createDagJournal({
      store,
      runId,
      initialCheckpoint: initialReplayCheckpoint(),
      applyEvent: applyReplayEvent,
    })
    expect(replayed.snapshot()).toEqual(expected)
  })

  test("#given a checkpoint crash on a new boundary event #when reopened #then replay recovers the uncheckpointed tail and seq continues", () => {
    const project = tempProject()
    const durableStore = createDagFileStore({ project_dir: project })
    let failOnce = true
    const crashingStore: DagFileStore = {
      ...durableStore,
      writeCheckpoint(id, checkpoint) {
        if (failOnce && (checkpoint as DagJournalCheckpoint).checkpointSeq === 2) {
          failOnce = false
          throw new Error("injected checkpoint crash")
        }
        durableStore.writeCheckpoint(id, checkpoint)
      },
    }
    const nodeA = "node-a" as DagNodeId
    const journal = createDagJournal({
      store: crashingStore,
      runId,
      initialCheckpoint: initialReplayCheckpoint(),
      applyEvent: applyReplayEvent,
    })

    journal.append(dagRunStartedEvent({ generation: 1 }))
    expect(() => journal.append(dagNodeRetriedEvent({ nodeId: nodeA, execAttempt: 1, promptChanged: false }))).toThrow("injected checkpoint crash")

    const reopened = createDagJournal({
      store: crashingStore,
      runId,
      initialCheckpoint: initialReplayCheckpoint(),
      applyEvent: applyReplayEvent,
    })
    reopened.append(dagRunStartedEvent({ generation: 2 }))

    expect(reopened.snapshot()).toEqual({
      schemaVersion: 1,
      checkpointSeq: 3,
      runId,
      generations: [1, 2],
      retried: [nodeA],
      steered: [],
      amendCount: 0,
    })
    expect(crashingStore.readEvents(runId, 0, { limit: 100 }).events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  test("#given a subscriber #when new boundary events are appended #then it receives them with monotonic seq", async () => {
    const store = createDagFileStore({ project_dir: tempProject() })
    const journal = createDagJournal({
      store,
      runId,
      initialCheckpoint: initialReplayCheckpoint(),
      applyEvent: applyReplayEvent,
    })
    const nodeA = "node-a" as DagNodeId
    const delivered: { readonly seq: number; readonly type: string }[] = []
    journal.subscribe((event) => {
      delivered.push({ seq: event.seq, type: event.type })
    })

    journal.append(dagNodeRetriedEvent({ nodeId: nodeA, execAttempt: 1, promptChanged: true }))
    journal.append(dagNodeSteeredEvent({ nodeId: nodeA, taskId: "task-a", delivery: "revive" }))
    await journal.whenIdle()

    expect(delivered).toEqual([
      { seq: 1, type: "dag.node.retried" },
      { seq: 2, type: "dag.node.steered" },
    ])
  })
})

describe("DAG journal refresh", () => {
  test("#given a foreign instance committed #when refresh is called #then the cached snapshot catches up without an own append", () => {
    // given - two instances over one run: caches are instance-local by design (#7412).
    const store = createDagFileStore({ project_dir: tempProject() })
    const first = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })
    const second = createDagJournal({ store, runId, initialCheckpoint: initialCheckpoint(), applyEvent })

    // when - only the second instance appends.
    second.append(dagRunStartedEvent({ generation: 7 }))

    // then - the first instance's cache is stale until it explicitly refreshes.
    expect(first.snapshot().generations).toEqual([])
    expect(first.refresh().generations).toEqual([7])
    expect(first.snapshot().generations).toEqual([7])
  })
})
