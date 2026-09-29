import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InboundEvent, SurfaceAdapter } from "../adapter/contract"
import { FakeAdapter, FakePlatform } from "../adapters/fake"
import { LineCollector } from "./fixtures/wait"
import { CATCH_UP_INTERVAL_MS, cursorPath, runConnectorHost, type ConnectorHostOptions } from "./host"
import { connectorLockPath, connectorsDir } from "./lock"
import { presencePath, readConnectorStatus } from "./presence"
import type { ConnectorSink, SinkRecord } from "./sink"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function agentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-host-"))
  roots.push(root)
  const dir = join(root, "agent")
  mkdirSync(connectorsDir(dir), { recursive: true, mode: 0o700 })
  return dir
}

class CollectingSink implements ConnectorSink {
  readonly records: SinkRecord[] = []
  private readonly waiters = new Set<() => void>()

  async emit(record: SinkRecord): Promise<void> {
    this.records.push(record)
    for (const waiter of this.waiters) waiter()
  }

  ids(): string[] {
    return this.records.map((record) => record.event.event_id)
  }

  until(count: number, timeoutMs = 30_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sink saw ${this.records.length}/${count} events`)), timeoutMs)
      const check = () => {
        if (this.records.length < count) return
        clearTimeout(timer)
        this.waiters.delete(check)
        resolve()
      }
      this.waiters.add(check)
      check()
    })
  }
}

function options(dir: string, adapter: SurfaceAdapter, sink: ConnectorSink, signal: AbortSignal): ConnectorHostOptions {
  return { agentDir: dir, scope: "qa", platform: "slack", account_id: "T000TEST", createAdapter: () => adapter, sink, mode: "live", signal }
}

function postTwenty(platform: FakePlatform): InboundEvent[] {
  return Array.from({ length: 20 }, (_, index) => platform.humanPost({ key: platform.chat, text: `message ${index}` }))
}

/** Replays every event twice: once live after connecting and once again through catchUp. */
class ReplayingAdapter extends FakeAdapter {
  override async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    for (const event of this.fake.inboundSince("")) onEvent(event)
    return super.listen(onEvent, signal, ready)
  }
}

/** A connected listener that silently misses every event: only catchUp can deliver them. */
class DeafAdapter extends FakeAdapter {
  listens = 0

  override async listen(_onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    this.listens += 1
    ready()
    await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve(), { once: true })))
  }
}

describe("connector host", () => {
  test("#given the same 20 events replayed live, by catch-up and again after a restart #then the sink sees 20 lines once", async () => {
    // given
    const dir = agentDir()
    const platform = new FakePlatform()
    const posted = postTwenty(platform)
    const sink = new CollectingSink()
    const controller = new AbortController()

    // when
    const running = runConnectorHost(options(dir, new ReplayingAdapter({ platform }), sink, controller.signal))
    await sink.until(20)
    controller.abort()
    const first = await running
    const restart = await runConnectorHost({ ...options(dir, new FakeAdapter({ platform }), sink, new AbortController().signal), once: true })

    // then
    expect(first.kind === "stopped" ? first.emitted : -1).toBe(20)
    expect(restart.kind === "stopped" ? restart.emitted : -1).toBe(0)
    expect(sink.ids()).toEqual(posted.map((event) => event.event_id))
  })

  test("#given a listener that misses an event #when the catch-up interval elapses #then the event reaches the sink without a reconnect", async () => {
    // given
    const dir = agentDir()
    const platform = new FakePlatform()
    const adapter = new DeafAdapter({ platform })
    const sink = new CollectingSink()
    const controller = new AbortController()
    const logs = new LineCollector()
    const running = runConnectorHost({ ...options(dir, adapter, sink, controller.signal), catchUpIntervalMs: 25, log: (line) => logs.push(line) })
    await logs.waitFor((line) => line.startsWith("caught up since "), 1, "first catch-up")

    // when
    const missed = platform.humanPost({ key: platform.chat, text: "missed by the listener" })
    const arrived = await sink.until(1, 3_000).then(() => true, () => false)
    controller.abort()
    const outcome = await running

    // then
    expect(arrived).toBe(true)
    expect(sink.ids()).toEqual([missed.event_id])
    expect(adapter.listens).toBe(1)
    expect(outcome.kind === "stopped" ? outcome.restarts : -1).toBe(0)
  })

  test("#given no injected interval #when listening #then the periodic catch-up runs every 120 s", async () => {
    // given
    const dir = agentDir()
    const controller = new AbortController()
    const logs = new LineCollector()
    const timers = spyOn(globalThis, "setInterval")
    let delays: unknown[] = []

    // when
    try {
      const running = runConnectorHost({ ...options(dir, new FakeAdapter(), new CollectingSink(), controller.signal), log: (line) => logs.push(line) })
      await logs.waitFor((line) => line.startsWith("caught up since "), 1, "first catch-up")
      controller.abort()
      await running
      delays = timers.mock.calls.map((call) => call[1])
    } finally {
      timers.mockRestore()
    }

    // then
    expect(CATCH_UP_INTERVAL_MS).toBe(120_000)
    expect(delays).toContain(CATCH_UP_INTERVAL_MS)
  })

  test("#given a running connector #when a second host starts for the account #then it attaches and never builds an adapter", async () => {
    // given
    const dir = agentDir()
    const sink = new CollectingSink()
    const controller = new AbortController()
    const logs = new LineCollector()
    const running = runConnectorHost({ ...options(dir, new FakeAdapter(), sink, controller.signal), log: (line) => logs.push(line) })
    await logs.waitFor((line) => line === "listening", 1, "listening")
    const status = await readConnectorStatus(dir, "slack", "T000TEST")
    let built = false

    // when
    const second = await runConnectorHost({ ...options(dir, new FakeAdapter(), sink, new AbortController().signal), createAdapter: () => {
      built = true
      return new FakeAdapter()
    } })
    controller.abort()
    await running

    // then
    expect(status.state === "alive" ? status.presence?.state : null).toBe("listening")
    expect(second.kind === "attached" ? second.holder.pid : null).toBe(process.pid)
    expect(built).toBe(false)
    expect(existsSync(connectorLockPath(dir, "slack", "T000TEST"))).toBe(false)
    expect(existsSync(presencePath(dir, "slack", "T000TEST"))).toBe(false)
  })

  test("#given listen fails, ends, then a long session fails #when supervised #then it restarts with exponential backoff that resets", async () => {
    // given
    const dir = agentDir()
    let clock = 0
    let attempt = 0
    const controller = new AbortController()
    const delays: number[] = []
    const adapter = new FakeAdapter()
    adapter.listen = async (_onEvent, signal, ready) => {
      attempt += 1
      if (attempt === 1) throw new Error("socket refused")
      if (attempt === 2) return
      if (attempt === 3) {
        clock += 400_000
        throw new Error("socket dropped")
      }
      if (attempt === 4) throw new Error("socket refused")
      ready()
      controller.abort()
      await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", () => resolve())))
    }

    // when
    const outcome = await runConnectorHost({
      ...options(dir, adapter, new CollectingSink(), controller.signal),
      now: () => new Date(clock),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })

    // then
    expect(delays).toEqual([1_000, 2_000, 1_000, 2_000])
    expect(outcome.kind === "stopped" ? outcome.restarts : -1).toBe(4)
  })

  test("#given an event whose hand-off is in flight #when the host is aborted #then it drains before releasing the lock", async () => {
    // given
    const dir = agentDir()
    const platform = new FakePlatform()
    let release: () => void = () => undefined
    const entered = Promise.withResolvers<void>()
    const sink: ConnectorSink = {
      emit: () =>
        new Promise<void>((resolve) => {
          release = resolve
          entered.resolve()
        }),
    }
    const controller = new AbortController()
    const logs = new LineCollector()
    const running = runConnectorHost({ ...options(dir, new FakeAdapter({ platform }), sink, controller.signal), log: (line) => logs.push(line) })
    await logs.waitFor((line) => line.startsWith("caught up since "), 1, "first catch-up")
    const event = platform.humanPost({ key: platform.chat, text: "in flight" })
    await entered.promise

    // when
    controller.abort()
    await logs.waitFor((line) => line === "draining", 1, "draining")
    const lockHeldWhileDraining = existsSync(connectorLockPath(dir, "slack", "T000TEST"))
    release()
    await running

    // then
    expect(lockHeldWhileDraining).toBe(true)
    expect(existsSync(connectorLockPath(dir, "slack", "T000TEST"))).toBe(false)
    expect(readFileSync(cursorPath(dir, "slack", "T000TEST", "live"), "utf8")).toContain(event.event_id)
  })

  test("#given a shadow run #when a live run follows #then shadow keeps its own cursor and sends nothing", async () => {
    // given
    const dir = agentDir()
    const platform = new FakePlatform()
    postTwenty(platform)
    const adapter = new FakeAdapter({ platform })
    const shadowSink = new CollectingSink()
    const liveSink = new CollectingSink()

    // when
    const shadow = await runConnectorHost({ ...options(dir, adapter, shadowSink, new AbortController().signal), mode: "shadow", once: true })
    const live = await runConnectorHost({ ...options(dir, adapter, liveSink, new AbortController().signal), once: true })

    // then
    expect(shadow.kind === "stopped" ? shadow.emitted : -1).toBe(20)
    expect(live.kind === "stopped" ? live.emitted : -1).toBe(20)
    expect(existsSync(cursorPath(dir, "slack", "T000TEST", "shadow"))).toBe(true)
    expect(adapter.ops).toEqual([])
  })
})
