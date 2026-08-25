// allow: SIZE_OK - the four dag query handlers share one real store fixture so ownership, paging stability, and envelope codes are proven against the same journal.
import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagNodeTransitionedEvent, dagRunStartedEvent } from "../../../../senpi-task/src/dag/events"
import { createDagJournal } from "../../../../senpi-task/src/dag/journal"
import { createDagManager, type DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { createDagFileStore } from "../../../../senpi-task/src/dag/store"
import type { DagNodeId, DagRunId } from "../../../../senpi-task/src/dag/types"
import type { SenpiExtensionAPI } from "../../extension/types"
import {
  registerDagRpcHandlers,
  type DagRpcEnvelope,
  type DagRpcHistoryPage,
  type DagRpcSubscribeHandshake,
} from "./dag-rpc-handlers"

const parentSessionId = "ses_parent"
const otherSessionId = "ses_other"
const rootSessionId = "ses_root"
const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-dag-rpc-"))
  cleanupRoots.push(directory)
  return directory
}

// A real DagManager over a real file store: ownership, sorting, and paging come from the engine,
// never from the test re-deriving them.
function engine(options: { readonly now?: () => number } = {}) {
  const projectDir = tempProject()
  const store = createDagFileStore({ project_dir: projectDir }, options.now === undefined ? {} : { now: options.now })
  let counter = 0
  const manager = createDagManager({
    store,
    newRunId: () => {
      counter += 1
      return `run-${counter}` as DagRunId
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { store, manager }
}

type Engine = ReturnType<typeof engine>

async function startRun(
  target: Engine,
  input: { readonly key: string; readonly name: string; readonly sessionId?: string },
): Promise<DagRunId> {
  const started = await target.manager.start({
    definition: {
      key: input.key,
      name: input.name,
      nodes: [
        { id: "plan", prompt: "draft the plan", category: "quick" },
        { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
      ],
    },
    parentSessionId: input.sessionId ?? parentSessionId,
    rootSessionId,
  })
  return started.snapshot.runId
}

// Appends through the real journal so every event carries a WAL-assigned seq, exactly as the
// scheduler would produce it.
function appender(target: Engine, runId: DagRunId) {
  const record = target.store.readCheckpoint<DagRunRecordV1>(runId)
  if (record === null) throw new Error(`missing checkpoint for ${runId}`)
  const journal = createDagJournal<DagRunRecordV1>({
    store: target.store,
    runId,
    initialCheckpoint: record,
    applyEvent: (checkpoint, event) => ({ ...checkpoint, checkpointSeq: event.seq }),
  })
  let transitions = 0
  return () => {
    transitions += 1
    return journal.append(
      transitions === 1
        ? dagRunStartedEvent({ generation: 1 })
        : dagNodeTransitionedEvent({
            nodeId: "plan" as DagNodeId,
            from: "pending",
            to: "running",
            reason: { kind: "started" },
          }),
    ).seq
  }
}

interface Handlers {
  readonly call: (name: string, data: unknown) => Promise<unknown>
  readonly names: readonly string[]
}

function wire(target: Engine, sessionId: () => string | undefined = () => parentSessionId): Handlers {
  const registered = new Map<string, (data: unknown) => unknown | Promise<unknown>>()
  const pi = {
    on() {},
    rpc: {
      emit() {},
      handle: (name: string, handler: (data: unknown) => unknown | Promise<unknown>) => {
        if (registered.has(name)) throw new Error(`duplicate handler ${name}`)
        registered.set(name, handler)
      },
    },
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    getFlag: () => undefined,
    sendMessage() {},
    sendUserMessage() {},
  } as unknown as SenpiExtensionAPI
  registerDagRpcHandlers(pi, { manager: target.manager, sessionId })
  return {
    names: [...registered.keys()],
    call: async (name, data) => {
      const handler = registered.get(name)
      if (handler === undefined) throw new Error(`no handler registered for ${name}`)
      return await handler(data)
    },
  }
}

function expectOk<T>(envelope: unknown): T {
  const typed = envelope as DagRpcEnvelope<T>
  if (!typed.ok) throw new Error(`expected ok envelope, received ${JSON.stringify(typed)}`)
  return typed.value
}

function expectError(envelope: unknown): { readonly code: string; readonly message: string } {
  const typed = envelope as DagRpcEnvelope<unknown>
  if (typed.ok) throw new Error(`expected error envelope, received ${JSON.stringify(typed)}`)
  return typed.error
}

describe("dag rpc handlers", () => {
  describe("#given a session that owns dag runs", () => {
    it("#when omo.dag.list is called #then it returns session-scoped summaries newest first", async () => {
      // given
      let clock = 1_000
      const target = engine({ now: () => clock })
      const first = await startRun(target, { key: "alpha", name: "alpha run" })
      clock = 2_000
      const second = await startRun(target, { key: "beta", name: "beta run" })
      clock = 3_000
      await startRun(target, { key: "gamma", name: "gamma run", sessionId: otherSessionId })
      const handlers = wire(target)

      // when
      const value = expectOk<{ readonly runs: readonly { readonly runId: string }[] }>(
        await handlers.call("omo.dag.list", {}),
      )

      // then
      expect(value.runs.map((run) => run.runId)).toEqual([second, first])
    }, 30_000)

    it("#when omo.dag.list requests a limit above the maximum #then the limit clamps to 256", async () => {
      // given
      const target = engine()
      await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target)
      const listed: number[] = []
      const spied = {
        ...target.manager,
        list: (session: string, options?: { readonly limit?: number }) => {
          listed.push(options?.limit ?? -1)
          return target.manager.list(session, options)
        },
      }
      const spiedHandlers = wire({ ...target, manager: spied })

      // when
      await spiedHandlers.call("omo.dag.list", { limit: 5_000 })
      const value = expectOk<{ readonly runs: readonly unknown[]; readonly limit: number }>(
        await handlers.call("omo.dag.list", { limit: 5_000 }),
      )

      // then
      expect(listed).toEqual([256])
      expect(value.limit).toBe(256)
    })

    it("#when omo.dag.list filters by status #then only matching runs come back", async () => {
      // given
      const target = engine()
      await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target)

      // when
      const pending = expectOk<{ readonly runs: readonly unknown[] }>(
        await handlers.call("omo.dag.list", { statuses: ["pending"] }),
      )
      const completed = expectOk<{ readonly runs: readonly unknown[] }>(
        await handlers.call("omo.dag.list", { statuses: ["completed"] }),
      )

      // then
      expect(pending.runs).toHaveLength(1)
      expect(completed.runs).toHaveLength(0)
    })

    it("#when omo.dag.snapshot is called #then the run snapshot round-trips", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target)

      // when
      const value = expectOk<{ readonly runId: string; readonly name: string; readonly nodes: readonly unknown[] }>(
        await handlers.call("omo.dag.snapshot", { runId }),
      )

      // then
      expect(value.runId).toBe(runId)
      expect(value.name).toBe("alpha run")
      expect(value.nodes).toHaveLength(2)
    })

    it("#when omo.dag.history pages a run #then it walks the ledger with an exclusive sinceSeq", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const append = appender(target, runId)
      for (let index = 0; index < 5; index += 1) append()
      const handlers = wire(target)

      // when
      const firstPage = expectOk<DagRpcHistoryPage>(await handlers.call("omo.dag.history", { runId, limit: 3 }))
      const secondPage = expectOk<DagRpcHistoryPage>(
        await handlers.call("omo.dag.history", { runId, sinceSeq: firstPage.nextSinceSeq, limit: 3 }),
      )

      // then
      expect(firstPage.events.map((event) => event.seq)).toEqual([1, 2, 3])
      expect(firstPage.hasMore).toBe(true)
      expect(secondPage.events.map((event) => event.seq)).toEqual([4, 5, 6])
      expect(secondPage.hasMore).toBe(false)
    })

    it("#when omo.dag.history requests a limit above the maximum #then the limit clamps to 1000", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target)
      const requested: (number | undefined)[] = []
      const spied = {
        ...target.manager,
        history: (params: Parameters<typeof target.manager.history>[0]) => {
          requested.push(params.limit)
          return target.manager.history(params)
        },
      }
      const spiedHandlers = wire({ ...target, manager: spied })

      // when
      await spiedHandlers.call("omo.dag.history", { runId, limit: 9_999 })

      // then
      expect(requested).toEqual([1_000])
    })

    it("#when events are appended while a bounded page walk is in flight #then the page set does not shift", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const append = appender(target, runId)
      for (let index = 0; index < 4; index += 1) append()
      const handlers = wire(target)
      const handshake = expectOk<DagRpcSubscribeHandshake>(
        await handlers.call("omo.dag.subscribe", { runId, limit: 2 }),
      )

      // when
      const walked = [...handshake.page.events.map((event) => event.seq)]
      let cursor = handshake.page.nextSinceSeq
      let hasMore = handshake.page.hasMore
      while (hasMore) {
        append()
        const page = expectOk<DagRpcHistoryPage>(
          await handlers.call("omo.dag.history", {
            runId,
            sinceSeq: cursor,
            throughSeq: handshake.highWaterSeq,
            limit: 2,
          }),
        )
        walked.push(...page.events.map((event) => event.seq))
        cursor = page.nextSinceSeq
        hasMore = page.hasMore
      }

      // then
      expect(walked).toEqual([1, 2, 3, 4, 5])
      expect(handshake.highWaterSeq).toBe(5)
    })

    it("#when omo.dag.subscribe is called #then highWaterSeq is captured before the page is read", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const append = appender(target, runId)
      for (let index = 0; index < 3; index += 1) append()
      const handlers = wire(target)
      const appendDuringRead = {
        ...target.manager,
        history: (params: Parameters<typeof target.manager.history>[0]) => {
          // A live scheduler keeps journaling while the handshake reads its first page: the returned
          // highWaterSeq must still describe the ledger as it was BEFORE that read.
          append()
          return target.manager.history(params)
        },
      }
      const racing = wire({ ...target, manager: appendDuringRead })

      // when
      const handshake = expectOk<DagRpcSubscribeHandshake>(await racing.call("omo.dag.subscribe", { runId }))

      // then
      expect(handshake.highWaterSeq).toBe(4)
      expect(handshake.page.events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
      expect(handshake.schemaVersion).toBe(1)
      expect(handshake.eventName).toBe("omo.dag.event")
      expect(handshake.snapshot.runId).toBe(runId)
    })

    it("#when subscribe is followed by bounded history paging #then applied seqs are contiguous to the high water mark", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const append = appender(target, runId)
      for (let index = 0; index < 7; index += 1) append()
      const handlers = wire(target)

      // when
      const handshake = expectOk<DagRpcSubscribeHandshake>(
        await handlers.call("omo.dag.subscribe", { runId, limit: 3 }),
      )
      const applied = [...handshake.page.events.map((event) => event.seq)]
      let cursor = handshake.page.nextSinceSeq
      let hasMore = handshake.page.hasMore
      while (hasMore) {
        const page = expectOk<DagRpcHistoryPage>(
          await handlers.call("omo.dag.history", {
            runId,
            sinceSeq: cursor,
            throughSeq: handshake.highWaterSeq,
            limit: 3,
          }),
        )
        applied.push(...page.events.map((event) => event.seq))
        cursor = page.nextSinceSeq
        hasMore = page.hasMore
      }

      // then
      expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(new Set(applied).size).toBe(applied.length)
    })

    it("#when history filters by lane and type #then the filters reach the ledger read", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const append = appender(target, runId)
      for (let index = 0; index < 3; index += 1) append()
      const handlers = wire(target)

      // when
      const boundary = expectOk<DagRpcHistoryPage>(await handlers.call("omo.dag.history", { runId, lane: "boundary" }))
      const started = expectOk<DagRpcHistoryPage>(
        await handlers.call("omo.dag.history", { runId, types: ["dag.run.started"] }),
      )

      // then
      expect(boundary.events).toHaveLength(4)
      expect(started.events.map((event) => event.type)).toEqual(["dag.run.started"])
    })
  })

  describe("#given a request the engine must reject", () => {
    it("#when a foreign session asks for a run #then every run-scoped handler answers run_not_owned", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target, () => otherSessionId)

      // when
      const snapshot = expectError(await handlers.call("omo.dag.snapshot", { runId }))
      const history = expectError(await handlers.call("omo.dag.history", { runId }))
      const subscribe = expectError(await handlers.call("omo.dag.subscribe", { runId }))
      const listed = expectOk<{ readonly runs: readonly unknown[] }>(await handlers.call("omo.dag.list", {}))

      // then
      expect([snapshot.code, history.code, subscribe.code]).toEqual([
        "run_not_owned",
        "run_not_owned",
        "run_not_owned",
      ])
      expect(listed.runs).toHaveLength(0)
    })

    it("#when the run id is unknown #then the envelope carries run_not_found instead of throwing", async () => {
      // given
      const target = engine()
      const handlers = wire(target)

      // when
      const snapshot = expectError(await handlers.call("omo.dag.snapshot", { runId: "run-missing" }))
      const history = expectError(await handlers.call("omo.dag.history", { runId: "run-missing" }))
      const subscribe = expectError(await handlers.call("omo.dag.subscribe", { runId: "run-missing" }))

      // then
      expect([snapshot.code, history.code, subscribe.code]).toEqual([
        "run_not_found",
        "run_not_found",
        "run_not_found",
      ])
    })

    it("#when params are malformed #then the envelope carries invalid_arguments", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target)

      // when
      const missingRunId = expectError(await handlers.call("omo.dag.snapshot", {}))
      const badSince = expectError(await handlers.call("omo.dag.history", { runId, sinceSeq: -1 }))
      const badLimit = expectError(await handlers.call("omo.dag.list", { limit: 0 }))
      const badLane = expectError(await handlers.call("omo.dag.history", { runId, lane: "sideways" }))
      const badStatus = expectError(await handlers.call("omo.dag.list", { statuses: ["exploded"] }))
      const badPayload = expectError(await handlers.call("omo.dag.subscribe", "not-an-object"))

      // then
      expect([
        missingRunId.code,
        badSince.code,
        badLimit.code,
        badLane.code,
        badStatus.code,
        badPayload.code,
      ]).toEqual([
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
        "invalid_arguments",
      ])
      expect(missingRunId.message.length).toBeGreaterThan(0)
    })

    it("#when the ledger read fails #then the envelope carries history_unavailable", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const broken = {
        ...target.manager,
        history: () => {
          throw new Error("event log is corrupt")
        },
      }
      const handlers = wire({ ...target, manager: broken })

      // when
      const history = expectError(await handlers.call("omo.dag.history", { runId }))
      const subscribe = expectError(await handlers.call("omo.dag.subscribe", { runId }))

      // then
      expect([history.code, subscribe.code]).toEqual(["history_unavailable", "history_unavailable"])
      expect(history.message).toContain("event log is corrupt")
    })

    it("#when no session is active #then run queries answer run_not_owned and never touch the engine", async () => {
      // given
      const target = engine()
      const runId = await startRun(target, { key: "alpha", name: "alpha run" })
      const handlers = wire(target, () => undefined)

      // when
      const snapshot = expectError(await handlers.call("omo.dag.snapshot", { runId }))
      const listed = expectOk<{ readonly runs: readonly unknown[] }>(await handlers.call("omo.dag.list", {}))

      // then
      expect(snapshot.code).toBe("run_not_owned")
      expect(listed.runs).toHaveLength(0)
    })
  })

  describe("#given the extension surface", () => {
    it("#when handlers are registered #then exactly the four dag query methods are bound once each", async () => {
      // given
      const target = engine()

      // when
      const handlers = wire(target)

      // then
      expect(handlers.names).toEqual([
        "omo.dag.list",
        "omo.dag.snapshot",
        "omo.dag.history",
        "omo.dag.subscribe",
      ])
    })
  })
})
