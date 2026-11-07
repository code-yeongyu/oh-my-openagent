import { describe, expect, test } from "bun:test"
import { LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import { createDeviceServiceSessions } from "./device-service"
import type { JsonObject, RemoteResync, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { followRemote } from "./remote-follow"

type AttachEvent = Parameters<Parameters<RemoteAttach["onEvent"]>[0]>[0]

// The device service's account side for one remote session: each attach replays its history from its latest snapshot
// to a new listener (as remote-attach.ts does), `get_state` answers the engine's current state, and closing the
// connection ends every attach on it with "closed".
function fakeDevice(engine: { state: JsonObject }) {
  const attaches: string[] = []
  const live: Array<{ readonly id: string; readonly emit: (event: AttachEvent) => void; readonly end: (reason: string) => void; readonly detachCalled: Promise<void>; detaches: number }> = []
  const connections: Array<() => void> = []
  let connects = 0
  const locate: { key?: string } = {}
  const connect = async (): Promise<DeviceService> => {
    connects += 1
    let close!: () => void
    const closed = new Promise<void>((resolve) => { close = resolve })
    connections.push(() => close())
    const mine: typeof live = []
    void closed.then(() => queueMicrotask(() => { for (const attach of mine) attach.end("closed") }))
    const service = {
      closed,
      close,
      locate: async () => { if (locate.key === undefined) throw new LocalApiError("session_not_found", "gone"); return { key: locate.key } },
      attach: async (_device: string, sessionId: string) => {
        attaches.push(sessionId)
        const history: AttachEvent[] = [{ kind: "snapshot", snapshot: { attach_id: 1, cursor: { marker_id: "m", last_entry_id: null }, state: { durableSessionId: "dur-1" }, entries: [], history_truncated: false, oldest_entry_id: null } }]
        const listeners = new Set<(event: AttachEvent) => void>()
        let finish!: (reason: string) => void
        const detached = new Promise<string>((resolve) => { finish = resolve })
        let ended = false
        let detachCalled!: () => void
        const entry = {
          id: sessionId,
          detaches: 0,
          detachCalled: new Promise<void>((resolve) => { detachCalled = resolve }),
          emit: (event: AttachEvent) => {
            if (event.kind === "snapshot") history.length = 0
            history.push(event)
            for (const listener of [...listeners]) listener(event)
          },
          end: (reason: string) => { if (ended) return; ended = true; listeners.clear(); finish(reason) },
        }
        live.push(entry)
        mine.push(entry)
        return {
          onEvent: (listener: (event: AttachEvent) => void) => {
            for (const event of history) listener(event)
            if (!ended) listeners.add(listener)
            return () => { listeners.delete(listener) }
          },
          detached,
          detach: async () => { entry.detaches += 1; detachCalled(); entry.end("detached") },
          command: async (): Promise<CommandResult> => ({ outcome: { type: "event", kind: "session.command_state", command_id: "c", state: "engine_applied", retryable: false }, response: { type: "response", success: true, data: engine.state } }) as unknown as CommandResult,
        } as unknown as RemoteAttach
      },
    } as unknown as DeviceService
    return service
  }
  const current = () => {
    const attach = live.at(-1)
    if (attach === undefined) throw new Error("nothing is attached")
    return attach
  }
  const snapshot = (attachId: number) => current().emit({ kind: "snapshot", snapshot: { attach_id: attachId, cursor: { marker_id: "m", last_entry_id: null }, state: {}, entries: [], history_truncated: false, oldest_entry_id: null } })
  const records = (attachId: number, records: readonly Readonly<Record<string, string>>[], seqs?: number[]) => current().emit({ kind: "records", attach_id: attachId, records, ...(seqs === undefined ? {} : { seqs }) })
  return { connect, attaches, live, locate, current, snapshot, records, connections, connects: () => connects }
}

// Each handler call lands in `log`; `until(n)` waits (bounded) for the n-th, subscribed before the trigger fires.
function recorder() {
  const log: string[] = []
  const waiters: Array<{ readonly n: number; readonly resolve: () => void }> = []
  const note = (line: string) => {
    log.push(line)
    for (const waiter of [...waiters]) if (log.length >= waiter.n) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve() }
  }
  const until = (n: number): Promise<void> => {
    if (log.length >= n) return Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    const reached = new Promise<void>((resolve) => waiters.push({ n, resolve }))
    const bound = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited 5s for ${n} watch events, saw ${JSON.stringify(log)}`)), 5_000) })
    return Promise.race([reached, bound]).finally(() => clearTimeout(timer))
  }
  const resynced = (resync: RemoteResync) => note(`resync ${resync.from ?? "-"} -> ${resync.state.status} settled=[${resync.settledTurns.join(",")}]${resync.restarted ? " restarted" : ""}`)
  const handlers = {
    record: (record: JsonObject) => note(`record ${String(record["type"])}${typeof record["turnId"] === "string" ? ` ${record["turnId"]}` : ""}`),
    resynced,
    lost: (reason: string) => note(`lost ${reason}`),
  }
  return { log, until, handlers }
}

const RUNNING = { isStreaming: true, currentTurnId: "7", durableSessionId: "dur-1" }
const IDLE = { isStreaming: false, durableSessionId: "dur-1" }
const portOver = (device: ReturnType<typeof fakeDevice>, attachIdleMs?: number) => createDeviceServiceSessions({ version: "0.0.0-test", connect: device.connect, retryDelay: async () => {}, ...(attachIdleMs === undefined ? {} : { attachIdleMs }) })

async function watching(port: ReturnType<typeof portOver>, handlers: ReturnType<typeof recorder>["handlers"], baseline = true) {
  const watched = await port.watch("b", "s1", handlers, { baseline })
  if (watched.kind !== "ok") throw new Error(`watch refused: ${watched.reason}`)
  return watched.watch
}

describe("device-service adapter: following a session's records", () => {
  test("#given an attach with history #when b's session is watched #then only records written after go to the handler, none after stop, and ended settles stopped", async () => {
    const device = fakeDevice({ state: IDLE })
    const watch = await watching(portOver(device), recorder().handlers, false)
    const seen = recorder()
    const second = await watching(portOver(device), seen.handlers, false)
    device.records(1, [{ type: "new" }])
    await seen.until(1)
    second.stop()
    device.records(1, [{ type: "after-stop" }])
    watch.stop()
    expect([seen.log, await second.ended]).toEqual([["record new"], "stopped"])
  })
})

describe("watch v2 (#12719): a remote session followed across drops, restarts and backlogs", () => {
  test("#given a turn running #when the relay re-establishes the attach while it settles #then one resync reports the turn once, and its late agent_settled is not reported again", async () => {
    const engine = { state: RUNNING as JsonObject }
    const device = fakeDevice(engine)
    const seen = recorder()
    const watch = await watching(portOver(device), seen.handlers)
    expect(watch.initial).toMatchObject({ status: "running", currentTurnId: "7", durableSessionId: "dur-1" })
    engine.state = IDLE
    device.snapshot(2)
    await seen.until(1)
    device.records(2, [{ type: "agent_settled", turnId: "7" }, { type: "agent_start", turnId: "8" }, { type: "agent_settled", turnId: "8" }])
    await seen.until(3)
    watch.stop()
    expect(seen.log).toEqual(["resync running -> idle settled=[7]", "record agent_start 8", "record agent_settled 8"])
  })

  test("#given records carrying stream seqs, with gaps, and records with none #when a seq repeats within the attach #then the repeat is dropped and every other record arrives once", async () => {
    const device = fakeDevice({ state: IDLE })
    const seen = recorder()
    const watch = await watching(portOver(device), seen.handlers)
    device.records(1, [{ type: "a" }, { type: "b" }], [3, 9])
    device.records(1, [{ type: "b" }, { type: "c" }], [9, 12])
    device.records(1, [{ type: "d" }])
    await seen.until(4)
    watch.stop()
    expect(seen.log).toEqual(["record a", "record b", "record c", "record d"])
  })

  test("#given the local device service restarts #when its connection closes #then the watch says lost once, reconnects, re-attaches and resyncs, and does not end", async () => {
    const engine = { state: RUNNING as JsonObject }
    const device = fakeDevice(engine)
    const seen = recorder()
    const port = portOver(device)
    const watch = await watching(port, seen.handlers)
    engine.state = IDLE
    device.connections[0]?.()
    await seen.until(2)
    const pending = await Promise.race([watch.ended, Promise.resolve("still watching")])
    watch.stop()
    expect([seen.log, device.connects(), device.attaches, pending]).toEqual([["lost closed", "resync running -> idle settled=[7]"], 2, ["s1", "s1"], "still watching"])
  })

  test("#given the engine restarted and relists the session under a new key #when the attach ends session_replaced #then the watch finds it by its durable id, re-attaches and resyncs once as restarted", async () => {
    const engine = { state: RUNNING as JsonObject }
    const device = fakeDevice(engine)
    const seen = recorder()
    const watch = await watching(portOver(device), seen.handlers)
    engine.state = IDLE
    device.locate.key = "s1-after"
    device.current().end("session_replaced")
    await seen.until(1)
    watch.stop()
    expect([seen.log, device.attaches]).toEqual([["resync running -> idle settled=[7] restarted"], ["s1", "s1-after"]])
  })

  test.each([
    ["session_closed", "session_closed"],
    ["peer_revoked", "access:peer_revoked"],
  ])("#given the attach ends %s and the session cannot be found again #then the watch ends %s, with no re-attach", async (reason, end) => {
    const device = fakeDevice({ state: IDLE })
    const watch = await watching(portOver(device), recorder().handlers)
    device.current().end(reason)
    expect([String(await watch.ended), device.attaches]).toEqual([end, ["s1"]])
  })

  test("#given two watches on one attach #when the first one's handler throws #then only that watch ends listener_failed, and the second keeps receiving on the same attach", async () => {
    const device = fakeDevice({ state: IDLE })
    const port = portOver(device)
    const throwing = await watching(port, { ...recorder().handlers, record: () => { throw new Error("boom") } })
    const seen = recorder()
    const kept = await watching(port, seen.handlers)
    device.records(1, [{ type: "one" }])
    expect(await throwing.ended).toBe("listener_failed")
    device.records(1, [{ type: "two" }])
    await seen.until(2)
    kept.stop()
    expect([seen.log, device.attaches]).toEqual([["record one", "record two"], ["s1"]])
  })

  test("#given two watches holding one attach #when one stops it stays, and when both stop #then the attach is detached", async () => {
    const device = fakeDevice({ state: IDLE })
    const port = portOver(device, 0)
    const first = await watching(port, recorder().handlers)
    const second = await watching(port, recorder().handlers)
    first.stop()
    const afterOne = device.current().detaches
    second.stop()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([device.current().detachCalled, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("waited 5s, the attach was never detached")), 5_000) })]).finally(() => clearTimeout(timer))
    expect([afterOne, device.current().detaches, device.attaches]).toEqual([0, 1, ["s1"]])
  })

  test("#given a backlog past the queue bound that buries the turn's agent_settled #when it drains #then content is dropped and one resync reports the turn settled", async () => {
    const engine = { state: RUNNING as JsonObject }
    const device = fakeDevice(engine)
    const seen = recorder()
    const watch = await watching(portOver(device), seen.handlers)
    engine.state = IDLE
    device.records(1, [...Array.from({ length: 300 }, () => ({ type: "message_update" })), { type: "agent_settled", turnId: "7" }])
    await seen.until(1)
    watch.stop()
    expect(seen.log).toEqual(["resync running -> idle settled=[7]"])
  })

  test("#given `omo remote send` following a turn #when the relay drops and the turn ends before the re-attach #then the follow still settles", async () => {
    const engine = { state: RUNNING as JsonObject }
    const device = fakeDevice(engine)
    const remote: RemoteThreadSurface = { sessions: { ...portOver(device), devices: async () => [{ device: "b", label: "b", online: true }] }, chain: { stamp: (record) => record } }
    const row: RemoteSessionRow = { device: "b", session_id: "s1", title: "", project: "", path: "", state: "idle", updated_ms: 0 }
    const follow = await followRemote(remote, row, () => {})
    if ("kind" in follow) throw new Error(follow.error.message)
    device.records(1, [{ type: "agent_start" }])
    engine.state = IDLE
    device.current().end("peer_detached")
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([follow.settled, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("waited 5s, never settled"), 5_000) })]).finally(() => clearTimeout(timer))
    follow.stop()
    expect(settled).toBe("settled")
  })
})

