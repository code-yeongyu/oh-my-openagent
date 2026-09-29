import type { InboundEvent } from "../../../adapter/contract"
import { DiscordAdapter, type DiscordAdapterOptions } from "../adapter"
import type { DiscordClock } from "../clock"
import { FakeDiscordServer, FAKE_TOKEN } from "./fake-server"
import { FAKE_BOT, FAKE_CHAT, FAKE_GUILD } from "./fake-state"

/** Real wall time for ids, but every wait (backoff, bucket, retry_after, op 9 delay) resolves at once and is recorded. */
export function fastClock(): DiscordClock & { slept: number[] } {
  const slept: number[] = []
  return {
    slept,
    now: () => Date.now(),
    sleep: (ms) => {
      slept.push(Math.round(ms))
      return Promise.resolve()
    },
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
    random: () => 0.5,
  }
}

/** Virtual time: nothing fires until `advance`; `sleep` jumps the clock forward. */
export class ManualClock implements DiscordClock {
  time = 0
  readonly slept: number[] = []
  private timers: { at: number; fn: () => void; id: number }[] = []
  private ids = 0

  now(): number {
    return this.time
  }

  sleep(ms: number): Promise<void> {
    this.slept.push(Math.round(ms))
    this.time += Math.max(0, ms)
    return Promise.resolve()
  }

  setTimer(fn: () => void, ms: number): () => void {
    const id = (this.ids += 1)
    this.timers.push({ at: this.time + ms, fn, id })
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id)
    }
  }

  random(): number {
    return 0
  }

  advance(ms: number): void {
    this.time += ms
    const due = this.timers.filter((timer) => timer.at <= this.time).sort((a, b) => a.at - b.at)
    this.timers = this.timers.filter((timer) => timer.at > this.time)
    for (const timer of due) timer.fn()
  }
}

export function adapterFor(server: FakeDiscordServer, overrides: Partial<DiscordAdapterOptions> = {}, logs: string[] = []): DiscordAdapter {
  return new DiscordAdapter({
    account_id: FAKE_BOT.id,
    token: FAKE_TOKEN,
    apiBase: server.apiBase,
    gatewayUrl: server.gatewayUrl,
    chats: [FAKE_CHAT],
    guild_id: FAKE_GUILD,
    clock: fastClock(),
    log: (line) => logs.push(line),
    ...overrides,
  })
}

export type Listening = {
  events: InboundEvent[]
  ready: Promise<void>
  done: Promise<unknown>
  waitForEvent(predicate: (event: InboundEvent) => boolean, what: string, ms?: number): Promise<InboundEvent>
  stop(): Promise<unknown>
}

/** Run `adapter.listen` in the background; `done` settles with null or the error listen rejected with. */
export function startListening(adapter: DiscordAdapter): Listening {
  const events: InboundEvent[] = []
  const waiters = new Set<() => void>()
  const controller = new AbortController()
  let markReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const done = adapter
    .listen(
      (event) => {
        events.push(event)
        for (const waiter of [...waiters]) waiter()
      },
      controller.signal,
      markReady,
    )
    .then(
      () => null,
      (error: unknown) => error,
    )
  const waitForEvent = (predicate: (event: InboundEvent) => boolean, what: string, ms = 5000) =>
    new Promise<InboundEvent>((resolve, reject) => {
      const check = () => {
        const hit = events.find(predicate)
        if (hit === undefined) return
        waiters.delete(check)
        clearTimeout(timer)
        resolve(hit)
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`waited ${ms} ms for ${what}; got ${JSON.stringify(events.map((event) => event.text))}`))
      }, ms)
      waiters.add(check)
      check()
    })
  return {
    events,
    ready,
    done,
    waitForEvent,
    stop: () => {
      controller.abort()
      return done
    },
  }
}
