// allow: SIZE_OK - acceptance tests keep the crash-safety matrix together and use shared real-directory fixtures.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"

import { createDagFileStore, DagJournalCorruptError } from "./store"
import type { DagRunEvent, DagRunId } from "./types"

const cleanupRoots: string[] = []
const runId = "run-1" as DagRunId
const otherRunId = "run-2" as DagRunId

const counts = {
  total: 0,
  pending: 0,
  blocked: 0,
  scheduled: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  skipped: 0,
}

afterEach(() => {
  mock.restore()
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-store-"))
  cleanupRoots.push(directory)
  return directory
}

function event(seq: number, input: Partial<DagRunEvent> = {}): DagRunEvent {
  return {
    schemaVersion: 1,
    runId,
    seq,
    at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    lane: "boundary",
    type: "dag.run.started",
    generation: seq,
    ...input,
  } as DagRunEvent
}

function checkpoint(input: {
  readonly id?: DagRunId
  readonly status?: "running" | "completed"
  readonly completedAt?: string
  readonly taskId?: string
} = {}) {
  return {
    schemaVersion: 1,
    runId: input.id ?? runId,
    runKey: `key-${input.id ?? runId}`,
    parentSessionId: "parent-session",
    status: input.status ?? "running",
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    nodes: input.taskId === undefined ? [] : [{ taskId: input.taskId }],
  }
}

describe("createDagFileStore event WAL", () => {
  test("#given five durable events #when reading two at a time #then sinceSeq is exclusive and hasMore flips", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    for (let seq = 1; seq <= 5; seq += 1) store.appendEvent(event(seq))

    // when
    const first = store.readEvents(runId, 0, { limit: 2 })
    const second = store.readEvents(runId, first.nextSinceSeq, { limit: 2 })
    const third = store.readEvents(runId, second.nextSinceSeq, { limit: 2 })

    // then
    expect(first.events.map(({ seq }) => seq)).toEqual([1, 2])
    expect(first).toMatchObject({ nextSinceSeq: 2, headSeq: 5, hasMore: true })
    expect(second.events.map(({ seq }) => seq)).toEqual([3, 4])
    expect(second).toMatchObject({ nextSinceSeq: 4, headSeq: 5, hasMore: true })
    expect(third.events.map(({ seq }) => seq)).toEqual([5])
    expect(third).toMatchObject({ nextSinceSeq: 5, headSeq: 5, hasMore: false })
  })

  test("#given mixed events beyond a catch-up boundary #when filtering a bounded page #then lane type and throughSeq all apply", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    store.appendEvent(event(1))
    store.appendEvent(event(2, { lane: "activity" }))
    store.appendEvent(event(3, { type: "dag.run.completed", counts }))
    store.appendEvent(event(4, { type: "dag.run.completed", counts }))

    // when
    const page = store.readEvents(runId, 1, {
      limit: 10,
      lane: "boundary",
      types: ["dag.run.completed"],
      throughSeq: 3,
    })

    // then
    expect(page.events.map(({ seq }) => seq)).toEqual([3])
    expect(page).toMatchObject({ nextSinceSeq: 3, headSeq: 4, hasMore: false })
  })

  test("#given an existing event seq #when a distinct event reuses it #then the WAL rejects the duplicate", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    store.appendEvent(event(1))

    // when
    const appendDuplicate = () => store.appendEvent(event(1, { generation: 2 }))

    // then
    expect(appendDuplicate).toThrow("DAG event seq must be strictly increasing")
    expect(store.readEvents(runId, 0, { limit: 10 }).events).toHaveLength(1)
  })

  test("#given default store durability #when one event is appended #then the WAL descriptor is fsynced", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const fsync = spyOn(fs, "fsyncSync")

    // when
    store.appendEvent(event(1))

    // then
    expect(fsync).toHaveBeenCalledTimes(1)
  })

  test("#given fsync is disabled #when WAL, lock, and checkpoint writes run #then ordering remains without durability barriers", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() }, { fsync: false })
    const fsync = spyOn(fs, "fsyncSync")

    // when
    store.withRunLock(runId, () => {
      store.appendEvent(event(1))
      store.writeCheckpoint(runId, { schemaVersion: 1, runId, checkpointSeq: 1 })
    })

    // then
    expect(fsync).not.toHaveBeenCalled()
    expect(store.readEvents(runId, 0, { limit: 10 }).events.map(({ seq }) => seq)).toEqual([1])
    expect(store.readCheckpoint<{ checkpointSeq: number }>(runId)?.checkpointSeq).toBe(1)
  })

  test("#given a WAL ending in a torn fragment #when a new store opens #then valid events remain and the tail is diagnosed and discarded", () => {
    // given
    const project = tempProject()
    const writer = createDagFileStore({ project_dir: project })
    writer.appendEvent(event(1))
    writer.appendEvent(event(2))
    fs.appendFileSync(writer.paths.event(runId), '{"schemaVersion":1,"runId":"run-1","seq":3')

    // when
    const recovered = createDagFileStore({ project_dir: project })
    const page = recovered.readEvents(runId, 0, { limit: 10 })

    // then
    expect(page.events.map(({ seq }) => seq)).toEqual([1, 2])
    expect(recovered.diagnostics()).toEqual([
      expect.objectContaining({ kind: "event_log_recovered", runId }),
    ])
    expect(fs.readFileSync(recovered.paths.event(runId), "utf8")).toEndWith("\n")
  })

  test("#given a future-schema event file #when a store opens #then it fails closed with a journal_corrupt diagnostic", () => {
    // given
    const project = tempProject()
    const seeded = createDagFileStore({ project_dir: project })
    fs.writeFileSync(seeded.paths.event(runId), `${JSON.stringify({ ...event(1), schemaVersion: 2 })}\n`)

    // when
    const open = () => createDagFileStore({ project_dir: project })

    // then
    expect(open).toThrow(DagJournalCorruptError)
    try {
      open()
    } catch (error) {
      expect((error as DagJournalCorruptError).diagnostic).toMatchObject({
        kind: "journal_corrupt",
        runId,
      })
    }
  })
})

describe("createDagFileStore checkpoints and layout", () => {
  test("#given POSIX checkpoint persistence #when an existing checkpoint is replaced #then readers see the old complete file until rename and both file and directory are fsynced", () => {
    // given
    const options = { isProcessAlive: () => true, platform: "darwin" as const }
    const store = createDagFileStore({ project_dir: tempProject() }, options)
    fs.writeFileSync(store.paths.run(runId), JSON.stringify({ schemaVersion: 1, runId, generation: 1 }))
    const realRename = fs.renameSync
    const observedBeforeRename: unknown[] = []
    const durabilityOrder: string[] = []
    const fsync = spyOn(fs, "fsyncSync").mockImplementation(() => {
      durabilityOrder.push("fsync")
    })
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      durabilityOrder.push("rename")
      observedBeforeRename.push(JSON.parse(fs.readFileSync(to, "utf8")) as unknown)
      realRename(from, to)
    })

    // when
    store.writeCheckpoint(runId, { schemaVersion: 1, runId, generation: 2 })

    // then
    expect(observedBeforeRename).toEqual([{ schemaVersion: 1, runId, generation: 1 }])
    expect(store.readCheckpoint<{ generation: number }>(runId)?.generation).toBe(2)
    expect(fsync).toHaveBeenCalledTimes(2)
    expect(durabilityOrder).toEqual(["fsync", "rename", "fsync"])
  })

  test("#given Windows checkpoint persistence #when directory fsync would fail with EPERM #then the atomic checkpoint still succeeds", () => {
    // given
    const options = { isProcessAlive: () => true, platform: "win32" as const }
    const store = createDagFileStore({ project_dir: tempProject() }, options)
    const fsync = spyOn(fs, "fsyncSync")
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        const error = new Error("operation not permitted")
        Object.assign(error, { code: "EPERM" })
        throw error
      })

    // when
    const write = () => store.writeCheckpoint(runId, { schemaVersion: 1, runId, generation: 1 })

    // then
    expect(write).not.toThrow()
    expect(fsync).toHaveBeenCalledTimes(1)
    expect(store.readCheckpoint<{ generation: number }>(runId)?.generation).toBe(1)
  })

  test("#given a future-schema checkpoint #when it is opened #then it fails closed with a journal_corrupt diagnostic", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    fs.writeFileSync(store.paths.run(runId), JSON.stringify({ schemaVersion: 2, runId }))

    // when
    const read = () => store.readCheckpoint(runId)

    // then
    expect(read).toThrow(DagJournalCorruptError)
    try {
      read()
    } catch (error) {
      expect((error as DagJournalCorruptError).diagnostic).toMatchObject({
        kind: "journal_corrupt",
        runId,
      })
    }
  })

  test("#given an existing node result #when it is replaced #then readers see the old complete file until rename and both file and directory are fsynced", () => {
    // given
    const options = { isProcessAlive: () => true, platform: "linux" as const }
    const store = createDagFileStore({ project_dir: tempProject() }, options)
    const realRename = fs.renameSync
    const observedBeforeRename: string[] = []
    const durabilityOrder: string[] = []
    const fsync = spyOn(fs, "fsyncSync").mockImplementation(() => {
      durabilityOrder.push("fsync")
    })
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      durabilityOrder.push("rename")
      if (fs.existsSync(to)) observedBeforeRename.push(fs.readFileSync(to, "utf8"))
      realRename(from, to)
    })
    store.writeResult(runId, "node-a", "old result")
    observedBeforeRename.length = 0
    durabilityOrder.length = 0
    fsync.mockClear()

    // when
    store.writeResult(runId, "node-a", "new result")

    // then
    expect(observedBeforeRename).toEqual(["old result"])
    expect(store.readResult(runId, "node-a")).toBe("new result")
    expect(fsync).toHaveBeenCalledTimes(2)
    expect(durabilityOrder).toEqual(["fsync", "rename", "fsync"])
  })

  test("#given a one-run session limit #when a second run checkpoint is created #then the configured limit rejects it without an orphan", () => {
    // given
    const store = createDagFileStore({
      project_dir: tempProject(),
      task: { dag: { max_runs_per_session: 1 } },
    })
    store.writeCheckpoint(runId, checkpoint())

    // when
    const writeSecond = () => store.writeCheckpoint(otherRunId, checkpoint({ id: otherRunId }))

    // then
    expect(writeSecond).toThrow("DAG session run limit reached: 1")
    expect(store.readCheckpoint(otherRunId)).toBeNull()
    expect(fs.readdirSync(store.paths.runs)).toEqual([`${runId}.json`])
  })

  test("#given a parent session and run key #when writing the key #then its filename is the exact nul-delimited sha256", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const parentSessionId = "parent/session"
    const runKey = "release-plan"
    const expectedHash = createHash("sha256").update(`${parentSessionId}\0${runKey}`).digest("hex")

    // when
    const path = store.writeKey({ schemaVersion: 1, parentSessionId, runKey, runId })

    // then
    expect(path).toBe(join(store.paths.keys, `${expectedHash}.json`))
    expect(store.readKey(parentSessionId, runKey)?.runId).toBe(runId)
  })
})

describe("createDagFileStore locks and retention", () => {
  test("#given a lock held by a dead pid #when the run lock is acquired #then the stale lock is reclaimed", () => {
    // given
    const store = createDagFileStore(
      { project_dir: tempProject() },
      { isProcessAlive: () => false },
    )
    fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: 2_147_483_647 }))
    let entered = false

    // when
    store.withRunLock(runId, () => {
      entered = true
      expect(fs.existsSync(store.paths.runLock(runId))).toBe(true)
    })

    // then
    expect(entered).toBe(true)
    expect(fs.existsSync(store.paths.runLock(runId))).toBe(false)
  })

  test("#given Windows lock publication #when hard links are rejected with EPERM #then the lock is still acquired and released", () => {
    // given
    const store = createDagFileStore(
      { project_dir: tempProject() },
      { isProcessAlive: () => true, platform: "win32" as const },
    )
    const realLink = fs.linkSync
    spyOn(fs, "linkSync").mockImplementation((from, to) => {
      if (typeof to === "string" && to === store.paths.runLock(runId)) {
        const error = new Error("operation not permitted")
        Object.assign(error, { code: "EPERM" })
        throw error
      }
      realLink(from, to)
    })
    let entered = false

    // when
    const acquire = () => store.withRunLock(runId, () => {
      entered = true
      expect(fs.existsSync(store.paths.runLock(runId))).toBe(true)
    })

    // then
    expect(acquire).not.toThrow()
    expect(entered).toBe(true)
    expect(fs.existsSync(store.paths.runLock(runId))).toBe(false)
  })

  test("#given a Windows lock already held by a live process #when a second acquirer races #then it observes the holder instead of crashing", () => {
    // given
    const holderPid = 424_242
    // The clock advances past the lock-wait ceiling so the contention path terminates instead of
    // spinning: this asserts the loser OBSERVES a live holder, never that it crashes on raw EPERM.
    let clock = 0
    const store = createDagFileStore(
      { project_dir: tempProject() },
      {
        isProcessAlive: (pid: number) => pid === holderPid,
        platform: "win32" as const,
        now: () => {
          clock += 1_001
          return clock
        },
      },
    )
    fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: holderPid, owner: "live" }))
    spyOn(fs, "linkSync").mockImplementation(() => {
      const error = new Error("operation not permitted")
      Object.assign(error, { code: "EPERM" })
      throw error
    })

    // when
    const acquire = () => store.withRunLock(runId, () => undefined)

    // then
    expect(acquire).toThrow(/Timed out acquiring DAG lock/)
  })

  test("#given a concurrent observer watches stale reclamation #when ownership changes #then the canonical lock path is never vacant", () => {
    // given
    const store = createDagFileStore(
      { project_dir: tempProject() },
      { isProcessAlive: () => false },
    )
    fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: 2_147_483_647, token: "stale" }))
    const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2))
    const observer = new Worker(`
      const { existsSync } = require("node:fs")
      const { workerData } = require("node:worker_threads")
      const signal = new Int32Array(workerData.signal)
      for (;;) {
        while (Atomics.load(signal, 0) === 0) Atomics.wait(signal, 0, 0)
        if (Atomics.load(signal, 0) === 3) break
        Atomics.store(signal, 1, existsSync(workerData.path) ? 1 : 0)
        Atomics.store(signal, 0, 2)
        Atomics.notify(signal, 0)
        while (Atomics.load(signal, 0) === 2) Atomics.wait(signal, 0, 2)
      }
    `, {
      eval: true,
      workerData: { path: store.paths.runLock(runId), signal: signal.buffer },
    })
    const observedPresence: boolean[] = []
    const observe = () => {
      Atomics.store(signal, 0, 1)
      Atomics.notify(signal, 0)
      while (Atomics.load(signal, 0) !== 2) {
        if (Atomics.wait(signal, 0, 1, 1_000) === "timed-out") throw new Error("lock observer timed out")
      }
      observedPresence.push(Atomics.load(signal, 1) === 1)
      Atomics.store(signal, 0, 0)
      Atomics.notify(signal, 0)
    }
    const realRename = fs.renameSync
    let observingReclamation = true
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      realRename(from, to)
      if (observingReclamation && (from === store.paths.runLock(runId) || to === store.paths.runLock(runId))) observe()
    })

    // when
    store.withRunLock(runId, () => {
      observe()
      observingReclamation = false
    })
    Atomics.store(signal, 0, 3)
    Atomics.notify(signal, 0)
    void observer.terminate()

    // then
    expect(observedPresence.length).toBeGreaterThan(0)
    expect(observedPresence).not.toContain(false)
  })

  test("#given two reclaimers validate one stale holder #when they contend at publication #then reclamation stays exclusive", () => {
    // given
    const project = tempProject()
    const stalePid = 101
    const contenderPid = 303
    let reclaimerClock = 0
    let contenderClock = 0
    const isProcessAlive = (pid: number) => pid === process.pid || pid === contenderPid
    const reclaimer = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          reclaimerClock += 1_001
          return reclaimerClock
        },
        isProcessAlive,
      },
    )
    const contender = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          contenderClock += 1_001
          return contenderClock
        },
        isProcessAlive,
      },
    )
    const canonical = reclaimer.paths.runLock(runId)
    const stale = JSON.stringify({ hostPid: stalePid, owner: "stale" })
    const contenderHolder = JSON.stringify({ hostPid: contenderPid, owner: "contender" })
    fs.writeFileSync(canonical, stale)
    const realRename = fs.renameSync
    let probingPublication = false
    let publicationProbed = false
    let contenderEntered = false
    let contenderLive = false
    let vacancyObserved = false
    let restoreOverwroteContender = false
    let overlappingLiveHoldersPossible = false
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!probingPublication && !publicationProbed && typeof from === "string" &&
        from.endsWith(".successor") && to === canonical) {
        probingPublication = true
        publicationProbed = true
        try {
          contender.withRunLock(runId, () => {
            contenderEntered = true
            contenderLive = true
            fs.writeFileSync(canonical, contenderHolder)
          })
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("Timed out acquiring DAG lock")) throw error
        }
        vacancyObserved ||= !fs.existsSync(canonical)
        realRename(from, to)
        restoreOverwroteContender ||= contenderLive
        probingPublication = false
        return
      }
      realRename(from, to)
    })

    // when
    reclaimer.withRunLock(runId, () => {
      overlappingLiveHoldersPossible ||= contenderLive
    })
    if (!contenderEntered) {
      contender.withRunLock(runId, () => {
        contenderEntered = true
        contenderLive = true
        fs.writeFileSync(canonical, contenderHolder)
      })
    }
    const finalHolder = fs.existsSync(canonical)
      ? JSON.parse(fs.readFileSync(canonical, "utf8")) as { readonly owner?: string }
      : undefined

    // then
    expect(publicationProbed).toBe(true)
    expect({
      vacancyObserved,
      contenderSurvived: finalHolder?.owner === "contender",
      restoreOverwroteContender,
      overlappingLiveHoldersPossible,
    }).toEqual({
      vacancyObserved: false,
      contenderSurvived: true,
      restoreOverwroteContender: false,
      overlappingLiveHoldersPossible: false,
    })
  })

  test("#given a second reclaimer observes sentinel initialization #when the first is preempted after open #then no ownerless sentinel is visible", () => {
    // given
    const project = tempProject()
    const isProcessAlive = (pid: number) => pid === process.pid
    const first = createDagFileStore({ project_dir: project }, { isProcessAlive })
    const second = createDagFileStore({ project_dir: project }, { isProcessAlive })
    const canonical = first.paths.runLock(runId)
    const reclaimSentinel = `${canonical}.reclaim`
    fs.writeFileSync(canonical, JSON.stringify({ hostPid: 101, token: "stale-holder" }))
    const realOpen = fs.openSync
    const realLink = fs.linkSync
    let preempted = false
    let secondReclaimerEntered = false
    let sentinelAbsentDuringInitialization = false
    let ownerlessSentinelObserved = false
    let publishedSentinelHadOwnerRecord = false
    spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      realLink(existingPath, newPath)
      if (newPath !== reclaimSentinel) return
      const value = JSON.parse(fs.readFileSync(reclaimSentinel, "utf8")) as unknown
      publishedSentinelHadOwnerRecord = typeof value === "object" && value !== null &&
        "hostPid" in value && typeof value.hostPid === "number" &&
        "token" in value && typeof value.token === "string"
    })
    spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      const fd = realOpen(path, flags, mode)
      if (preempted || flags !== "wx" || typeof path !== "string" || !path.startsWith(reclaimSentinel)) return fd
      preempted = true
      sentinelAbsentDuringInitialization = !fs.existsSync(reclaimSentinel)
      if (!sentinelAbsentDuringInitialization) {
        const content = fs.readFileSync(reclaimSentinel, "utf8")
        try {
          const value = JSON.parse(content) as unknown
          ownerlessSentinelObserved = typeof value !== "object" || value === null ||
            !("hostPid" in value) || typeof value.hostPid !== "number" ||
            !("token" in value) || typeof value.token !== "string"
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          ownerlessSentinelObserved = true
        }
      }
      second.withRunLock(runId, () => {
        secondReclaimerEntered = true
      })
      return fd
    })

    // when
    first.withRunLock(runId, () => {})

    // then
    expect({
      preempted,
      secondReclaimerEntered,
      sentinelAbsentDuringInitialization,
      ownerlessSentinelObserved,
      publishedSentinelHadOwnerRecord,
    }).toEqual({
      preempted: true,
      secondReclaimerEntered: true,
      sentinelAbsentDuringInitialization: true,
      ownerlessSentinelObserved: false,
      publishedSentinelHadOwnerRecord: true,
    })
  })

  test("#given a crashed reclaimer left its sentinel #when another process reclaims the stale holder #then the sentinel cannot wedge acquisition", () => {
    // given
    const store = createDagFileStore(
      { project_dir: tempProject() },
      { isProcessAlive: () => false },
    )
    const canonical = store.paths.runLock(runId)
    const reclaimSentinel = `${canonical}.reclaim`
    fs.writeFileSync(canonical, JSON.stringify({ hostPid: 101, token: "stale-holder" }))
    fs.writeFileSync(reclaimSentinel, JSON.stringify({ hostPid: 202, token: "crashed-reclaimer" }))
    let entered = false

    // when
    store.withRunLock(runId, () => {
      entered = true
    })

    // then
    expect(entered).toBe(true)
    expect(fs.existsSync(reclaimSentinel)).toBe(false)
  })

  test("#given a contender probes every reclamation transition #when a stale lock is replaced #then only the reclaimer concludes it holds the lock", () => {
    // given
    const project = tempProject()
    const reclaimer = createDagFileStore(
      { project_dir: project },
      { isProcessAlive: () => false },
    )
    let contenderClock = 0
    const contender = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          contenderClock += 1_001
          return contenderClock
        },
        isProcessAlive: () => true,
      },
    )
    fs.writeFileSync(reclaimer.paths.runLock(runId), JSON.stringify({ hostPid: 2_147_483_647, token: "stale" }))
    const realRename = fs.renameSync
    let probed = false
    let contenderEntered = false
    let contenderRejected = false
    let reclaimerEntered = false
    spyOn(fs, "renameSync").mockImplementation((from, to) => {
      realRename(from, to)
      if (!probed && !reclaimerEntered &&
        (from === reclaimer.paths.runLock(runId) || to === reclaimer.paths.runLock(runId))) {
        probed = true
        try {
          contender.withRunLock(runId, () => {
            contenderEntered = true
          })
        } catch (error) {
          contenderRejected = error instanceof Error && error.message.includes("Timed out acquiring DAG lock")
        }
      }
    })

    // when
    reclaimer.withRunLock(runId, () => {
      reclaimerEntered = true
    })

    // then
    expect(probed).toBe(true)
    expect(reclaimerEntered).toBe(true)
    expect(contenderRejected).toBe(true)
    expect(contenderEntered).toBe(false)
  })

  test("#given a fresh holder acquires between stale inspection and removal #when the run lock retries #then the fresh lock survives and the reclaimer never enters", () => {
    // given
    const project = tempProject()
    let clock = 0
    const stalePid = 101
    const freshPid = 202
    let replaced = false
    const store = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          clock += 1_001
          return clock
        },
        isProcessAlive: (pid) => pid === freshPid,
      },
    )
    const stale = JSON.stringify({ hostPid: stalePid, owner: "stale" })
    const fresh = JSON.stringify({ hostPid: freshPid, owner: "fresh" })
    fs.writeFileSync(store.paths.runLock(runId), stale)
    const realOpen = fs.openSync
    spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      const fd = realOpen(path, flags, mode)
      if (!replaced && typeof path === "string" && path.endsWith(".successor")) {
        replaced = true
        fs.writeFileSync(store.paths.runLock(runId), fresh)
      }
      return fd
    })
    let entered = false

    // when
    const acquire = () => store.withRunLock(runId, () => { entered = true })

    // then
    expect(acquire).toThrow(`Timed out acquiring DAG lock: ${store.paths.runLock(runId)}`)
    expect(replaced).toBe(true)
    expect(entered).toBe(false)
    expect(fs.readFileSync(store.paths.runLock(runId), "utf8")).toBe(fresh)
  })

  test("#given a contender replaces the observed stale holder before atomic takeover #when validation runs #then the contender wins and the reclaimer never enters", () => {
    // given
    const project = tempProject()
    let clock = 0
    const stalePid = 101
    const freshPid = 202
    const contenderPid = 303
    let successorPrepared = false
    const store = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          clock += 1_001
          return clock
        },
        isProcessAlive: (pid) => pid === freshPid || pid === contenderPid,
      },
    )
    const stale = JSON.stringify({ hostPid: stalePid, owner: "stale" })
    const fresh = JSON.stringify({ hostPid: freshPid, owner: "fresh-before-quarantine" })
    const contender = JSON.stringify({ hostPid: contenderPid, owner: "contender" })
    fs.writeFileSync(store.paths.runLock(runId), stale)
    const realOpen = fs.openSync
    spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      const fd = realOpen(path, flags, mode)
      if (!successorPrepared && typeof path === "string" && path.endsWith(".successor")) {
        successorPrepared = true
        fs.writeFileSync(store.paths.runLock(runId), fresh)
        fs.writeFileSync(store.paths.runLock(runId), contender)
      }
      return fd
    })
    let entered = false

    // when
    const acquire = () => store.withRunLock(runId, () => { entered = true })

    // then
    expect(acquire).toThrow(`Timed out acquiring DAG lock: ${store.paths.runLock(runId)}`)
    expect(successorPrepared).toBe(true)
    expect(entered).toBe(false)
    expect(fs.readFileSync(store.paths.runLock(runId), "utf8")).toBe(contender)
  })

  test("#given an acquired lock path is replaced before release #when the original holder exits #then it never unlinks the replacement", () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const contender = JSON.stringify({ hostPid: 303, owner: "contender" })

    // when
    store.withRunLock(runId, () => {
      fs.rmSync(store.paths.runLock(runId))
      fs.writeFileSync(store.paths.runLock(runId), contender)
    })

    // then
    expect(fs.readFileSync(store.paths.runLock(runId), "utf8")).toBe(contender)
  })

  test("#given a dead holder is replaced before reclamation #when the run lock retries #then it never deletes the fresh holder", () => {
    // given
    const project = tempProject()
    let clock = 0
    const stalePid = 101
    const freshPid = 202
    let replaced = false
    const store = createDagFileStore(
      { project_dir: project },
      {
        now: () => {
          clock += 1_001
          return clock
        },
        isProcessAlive: (pid) => {
          if (pid === stalePid && !replaced) {
            replaced = true
            fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: freshPid }))
            return false
          }
          return pid === freshPid
        },
      },
    )
    fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: stalePid }))
    let entered = false

    // when
    const acquire = () => store.withRunLock(runId, () => { entered = true })

    // then
    expect(acquire).toThrow(`Timed out acquiring DAG lock: ${store.paths.runLock(runId)}`)
    expect(entered).toBe(false)
    expect(JSON.parse(fs.readFileSync(store.paths.runLock(runId), "utf8"))).toEqual({ hostPid: freshPid })
  })

  test("#given expired terminal artifacts and equally old live artifacts #when retention runs #then only the terminal run is pruned", () => {
    // given
    const now = Date.parse("2026-01-10T00:00:00.000Z")
    const project = tempProject()
    const store = createDagFileStore({
      project_dir: project,
      task: { dag: { retention_days: 7 } },
    })
    const old = "2026-01-01T00:00:00.000Z"
    const taskId = "st_dead-owner"
    store.writeCheckpoint(runId, checkpoint({ status: "completed", completedAt: old, taskId }))
    store.writeCheckpoint(otherRunId, checkpoint({ id: otherRunId, status: "running", completedAt: old }))
    store.appendEvent(event(1))
    store.appendEvent(event(1, { runId: otherRunId }))
    store.writeResult(runId, "node-a", "terminal result")
    store.writeResult(otherRunId, "node-a", "live result")
    const terminalKey = store.writeKey({
      schemaVersion: 1,
      parentSessionId: "parent-session",
      runKey: "key-run-1",
      runId,
    })
    const liveKey = store.writeKey({
      schemaVersion: 1,
      parentSessionId: "parent-session",
      runKey: "key-run-2",
      runId: otherRunId,
    })
    fs.writeFileSync(store.paths.runLock(runId), JSON.stringify({ hostPid: 1, runId }))
    fs.writeFileSync(store.paths.keyLock("parent-session", "key-run-1"), JSON.stringify({ hostPid: 1, runId }))
    fs.writeFileSync(store.paths.taskOwnerLock(taskId), JSON.stringify({ hostPid: 1, runId }))

    // when
    const pruned = store.pruneExpired(now)

    // then
    expect(pruned).toEqual([runId])
    expect(fs.existsSync(store.paths.run(runId))).toBe(false)
    expect(fs.existsSync(store.paths.event(runId))).toBe(false)
    expect(fs.existsSync(join(store.paths.results, runId))).toBe(false)
    expect(fs.existsSync(terminalKey)).toBe(false)
    expect(fs.existsSync(store.paths.runLock(runId))).toBe(false)
    expect(fs.existsSync(store.paths.keyLock("parent-session", "key-run-1"))).toBe(false)
    expect(fs.existsSync(store.paths.taskOwnerLock(taskId))).toBe(false)
    expect(fs.existsSync(store.paths.run(otherRunId))).toBe(true)
    expect(fs.existsSync(store.paths.event(otherRunId))).toBe(true)
    expect(fs.existsSync(join(store.paths.results, otherRunId))).toBe(true)
    expect(fs.existsSync(liveKey)).toBe(true)
  })

  test("#given expired terminal and equally old live skill sidecars #when retention runs #then only the terminal sidecar is pruned", () => {
    // given
    const now = Date.parse("2026-01-10T00:00:00.000Z")
    const old = "2026-01-01T00:00:00.000Z"
    const store = createDagFileStore({
      project_dir: tempProject(),
      task: { dag: { retention_days: 7 } },
    })
    store.writeCheckpoint(runId, checkpoint({ status: "completed", completedAt: old }))
    store.writeCheckpoint(otherRunId, checkpoint({ id: otherRunId, status: "running", completedAt: old }))
    const skillsDirectory = join(store.paths.root, "skills")
    const terminalSkills = join(skillsDirectory, `${runId}.json`)
    const liveSkills = join(skillsDirectory, `${otherRunId}.json`)
    fs.mkdirSync(skillsDirectory, { recursive: true })
    fs.writeFileSync(terminalSkills, JSON.stringify({ runId }))
    fs.writeFileSync(liveSkills, JSON.stringify({ runId: otherRunId }))

    // when
    store.pruneExpired(now)

    // then
    expect(fs.existsSync(terminalSkills)).toBe(false)
    expect(fs.existsSync(liveSkills)).toBe(true)
  })
})
