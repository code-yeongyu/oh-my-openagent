// allow: SIZE_OK - the executable viewer algorithm, real event-plane fixture, and race assertions stay together so the catch-up ordering remains reviewable as one proof.
import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagRunStartedEvent } from "../../../../senpi-task/src/dag/events"
import { createDagJournal } from "../../../../senpi-task/src/dag/journal"
import {
  createDagManager,
  type DagHistoryParams,
  type DagRunRecordV1,
} from "../../../../senpi-task/src/dag/manager"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import type { DagRunEvent, DagRunId } from "../../../../senpi-task/src/dag/types"
import type { SenpiExtensionAPI } from "../../extension/types"
import {
  createDagRpcBridge,
  DAG_ACTIVITY_COALESCE_MS,
  type DagBridgeActivityEvent,
} from "./dag-rpc-bridge"
import {
  registerDagRpcHandlers,
  type DagRpcEnvelope,
  type DagRpcEvent,
  type DagRpcHistoryPage,
  type DagRpcSubscribeHandshake,
} from "./dag-rpc-handlers"

const parentSessionId = "ses_viewer_parent"
const rootSessionId = "ses_viewer_root"
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type RpcListener = (data: unknown) => void

type ViewerRpc = {
  readonly listen: (name: string, listener: RpcListener) => () => void
  readonly call: (name: string, data: unknown) => Promise<unknown>
}

function rpcBus(options: { readonly dropLiveSeq: number; readonly duplicateLiveSeq: number }) {
  const handlers = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  const listeners = new Map<string, Set<RpcListener>>()
  const operations: string[] = []
  const publish = (name: string, data: unknown): void => {
    const event = data as Partial<DagRpcEvent>
    if (name === "omo.dag.event" && event.seq === options.dropLiveSeq) return
    const deliveries = name === "omo.dag.event" && event.seq === options.duplicateLiveSeq ? 2 : 1
    for (let index = 0; index < deliveries; index += 1) {
      for (const listener of listeners.get(name) ?? []) listener(data)
    }
  }
  const pi = {
    on() {},
    rpc: {
      emit: publish,
      handle(name: string, handler: (data: unknown) => unknown | Promise<unknown>) {
        handlers.set(name, handler)
      },
    },
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    sendMessage() {},
    sendUserMessage() {},
  } as unknown as SenpiExtensionAPI
  const rpc: ViewerRpc = {
    listen(name, listener) {
      operations.push(`listen:${name}`)
      const named = listeners.get(name) ?? new Set<RpcListener>()
      named.add(listener)
      listeners.set(name, named)
      return () => void named.delete(listener)
    },
    async call(name, data) {
      operations.push(`call:${name}`)
      const handler = handlers.get(name)
      if (handler === undefined) throw new Error(`missing RPC handler ${name}`)
      return await handler(data)
    },
  }
  return { pi, rpc, operations, publish }
}

function manualTimers() {
  const callbacks = new Map<number, () => void>()
  let nextId = 1
  return {
    seam: {
      set(callback: () => void) {
        const id = nextId
        nextId += 1
        callbacks.set(id, callback)
        return id
      },
      clear(handle: number) {
        callbacks.delete(handle)
      },
    },
    flushOne() {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of pending) callback()
    },
  }
}

function expectOk<T>(envelope: unknown): T {
  const typed = envelope as DagRpcEnvelope<T>
  if (!typed.ok) throw new Error(`expected ok envelope, received ${JSON.stringify(typed)}`)
  return typed.value
}

class ReferenceDagViewer {
  readonly applied: DagRpcEvent[] = []
  readonly gaps: { readonly expected: number; readonly received: number }[] = []
  readonly activityByNode = new Map<string, DagBridgeActivityEvent>()
  readonly recoveryQueries: { readonly sinceSeq: number; readonly throughSeq: number }[] = []
  readonly seen = new Set<string>()
  lastAppliedSeq = 0
  historyRequests = 0

  private readonly liveBuffer: DagRpcEvent[] = []
  private catchingUp = true
  private liveWork = Promise.resolve()

  constructor(
    private readonly rpc: ViewerRpc,
    private readonly runId: string,
    private readonly pageLimit: number,
  ) {}

  async catchUp(): Promise<DagRpcSubscribeHandshake> {
    this.rpc.listen("omo.dag.event", (value) => {
      const event = value as DagRpcEvent
      if (event.runId !== this.runId) return
      if (this.catchingUp) {
        this.liveBuffer.push(event)
        return
      }
      this.liveWork = this.liveWork.then(() => this.applyLive(event))
    })
    this.rpc.listen("omo.dag.activity", (value) => {
      const activity = value as DagBridgeActivityEvent
      if (activity.runId === this.runId) this.activityByNode.set(activity.nodeId, activity)
    })

    const handshake = expectOk<DagRpcSubscribeHandshake>(
      await this.rpc.call("omo.dag.subscribe", { runId: this.runId, limit: this.pageLimit }),
    )
    this.applyPage(handshake.page.events)
    let page = handshake.page
    while (page.hasMore) {
      page = await this.history(page.nextSinceSeq, handshake.highWaterSeq)
      this.applyPage(page.events)
    }

    while (this.liveBuffer.length > 0) {
      const buffered = this.liveBuffer.splice(0).sort((left, right) => left.seq - right.seq)
      for (const event of buffered) {
        if (event.seq <= this.lastAppliedSeq) continue
        await this.applyLive(event)
      }
    }
    this.catchingUp = false
    return handshake
  }

  async idle(): Promise<void> {
    await this.liveWork
  }

  private async applyLive(event: DagRpcEvent): Promise<void> {
    if (this.seen.has(this.key(event))) return
    if (event.seq > this.lastAppliedSeq + 1) await this.recoverThrough(event.seq - 1)
    this.apply(event)
  }

  private async recoverThrough(throughSeq: number): Promise<void> {
    this.recoveryQueries.push({ sinceSeq: this.lastAppliedSeq, throughSeq })
    let page: DagRpcHistoryPage
    do {
      page = await this.history(this.lastAppliedSeq, throughSeq)
      this.applyPage(page.events)
    } while (page.hasMore)
  }

  private async history(sinceSeq: number, throughSeq: number): Promise<DagRpcHistoryPage> {
    this.historyRequests += 1
    return expectOk<DagRpcHistoryPage>(await this.rpc.call("omo.dag.history", {
      runId: this.runId,
      sinceSeq,
      throughSeq,
      limit: this.pageLimit,
    }))
  }

  private applyPage(events: readonly DagRpcEvent[]): void {
    for (const event of [...events].sort((left, right) => left.seq - right.seq)) this.apply(event)
  }

  private apply(event: DagRpcEvent): void {
    const key = this.key(event)
    if (this.seen.has(key)) return
    if (event.seq !== this.lastAppliedSeq + 1) {
      this.gaps.push({ expected: this.lastAppliedSeq + 1, received: event.seq })
    }
    this.seen.add(key)
    this.applied.push(event)
    this.lastAppliedSeq = event.seq
  }

  private key(event: DagRpcEvent): string {
    return `${event.runId}\u0000${event.seq}`
  }
}

function activity(runId: string, label: string): DagBridgeActivityEvent {
  return {
    schemaVersion: 1,
    runId,
    nodeId: "build",
    taskId: "st_build",
    at: "2026-08-14T00:00:00.000Z",
    activity: label,
    turns: 3,
  }
}

describe("dag viewer reference consumer", () => {
  it("#given a 200-event live run #when catch-up races live delivery #then application is gap-free and duplicate-free", async () => {
    // given
    const projectDir = fs.mkdtempSync(join(tmpdir(), "omo-dag-viewer-"))
    cleanupRoots.push(projectDir)
    const store = createDagFileStore({ project_dir: projectDir }, { fsync: false })
    const runId = "run-viewer" as DagRunId
    const manager = createDagManager({ store, newRunId: () => runId })
    await manager.start({
      definition: {
        key: "viewer-proof",
        name: "viewer proof",
        nodes: [{ id: "build", prompt: "build it", category: "quick" }],
      },
      parentSessionId,
      rootSessionId,
    })
    const checkpoint = manager.record(runId, parentSessionId)
    const journal = createDagJournal<DagRunRecordV1>({
      store,
      runId,
      initialCheckpoint: checkpoint,
      applyEvent: (record) => record,
      subscriberRing: 256,
    })
    while (journal.snapshot().checkpointSeq < 150) journal.append(dagRunStartedEvent({ generation: 1 }))

    const bus = rpcBus({ dropLiveSeq: 176, duplicateLiveSeq: 190 })
    const timers = manualTimers()
    const bridge = createDagRpcBridge(bus.pi, {
      liveRuns: () => [{ runId, status: "running", subscribe: journal.subscribe }],
      timers: timers.seam,
    })
    bridge.attach()

    let historyReads = 0
    const tappedManager = {
      ...manager,
      history(params: DagHistoryParams) {
        historyReads += 1
        const targetSeq = historyReads === 1 ? 175 : historyReads === 2 ? 200 : undefined
        if (targetSeq !== undefined) {
          while (journal.snapshot().checkpointSeq < targetSeq) journal.append(dagRunStartedEvent({ generation: 1 }))
          bridge.publishActivity(activity(runId, historyReads === 1 ? "catching up" : "still running"))
          timers.flushOne()
        }
        return manager.history(params)
      },
    }
    registerDagRpcHandlers(bus.pi, { manager: tappedManager, sessionId: () => parentSessionId })
    const viewer = new ReferenceDagViewer(bus.rpc, runId, 37)

    // when
    const handshake = await viewer.catchUp()
    await journal.whenIdle()
    await viewer.idle()

    // then
    expect(bus.operations.indexOf("listen:omo.dag.event")).toBeLessThan(
      bus.operations.indexOf("call:omo.dag.subscribe"),
    )
    expect(handshake.highWaterSeq).toBe(150)
    expect(viewer.recoveryQueries).toEqual([{ sinceSeq: 175, throughSeq: 176 }])
    expect(viewer.gaps).toEqual([])
    expect(viewer.applied.map((event) => event.seq)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    )
    expect(viewer.seen.size).toBe(viewer.applied.length)
    expect(viewer.lastAppliedSeq).toBe(manager.snapshot(runId, parentSessionId).lastSeq)

    const appliedBeforeReplay = viewer.applied.length
    bus.publish("omo.dag.event", viewer.applied.at(-1))
    await viewer.idle()
    expect(viewer.applied).toHaveLength(appliedBeforeReplay)

    const seqBeforeActivity = viewer.lastAppliedSeq
    const historyBeforeActivity = viewer.historyRequests
    bridge.publishActivity(activity(runId, "render only"))
    timers.flushOne()
    await viewer.idle()
    expect(viewer.activityByNode.get("build")?.activity).toBe("render only")
    expect(viewer.lastAppliedSeq).toBe(seqBeforeActivity)
    expect(viewer.historyRequests).toBe(historyBeforeActivity)
  })
})
