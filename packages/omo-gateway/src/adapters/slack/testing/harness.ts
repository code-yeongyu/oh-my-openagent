import type { InboundEvent } from "../../../adapter/contract"
import { SlackAdapter, type SlackAdapterOptions } from "../adapter"
import type { SlackClock } from "../clock"
import type { TokenKind } from "../outbound"
import type { FakeSlackServer } from "./fake-server"
import { FAKE_APP_TOKEN, FAKE_BOT_TOKEN, FAKE_CHAT, FAKE_COOKIE, FAKE_DM, FAKE_TEAM, FAKE_USER_TOKEN } from "./fake-state"

/** Virtual time: waits jump the clock and resolve at once; timers fire only on `advance`. */
export class ManualClock implements SlackClock {
  time = Date.now()
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

  get pending(): number {
    return this.timers.length
  }

  advance(ms: number): void {
    this.time += ms
    const due = this.timers.filter((timer) => timer.at <= this.time).sort((a, b) => a.at - b.at)
    this.timers = this.timers.filter((timer) => timer.at > this.time)
    for (const timer of due) timer.fn()
  }
}

/** Real wall time for timers (bounded waits still work), but sleeps resolve at once, move the clock and are recorded. */
export function fastClock(): SlackClock & { slept: number[] } {
  const slept: number[] = []
  let skipped = 0
  return {
    slept,
    now: () => Date.now() + skipped,
    sleep: (ms) => {
      slept.push(Math.round(ms))
      skipped += Math.max(0, ms)
      return Promise.resolve()
    },
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      timer.unref()
      return () => clearTimeout(timer)
    },
  }
}

export function adapterFor(server: FakeSlackServer, kind: TokenKind = "user", overrides: Partial<SlackAdapterOptions> = {}, logs: string[] = []): SlackAdapter {
  const secrets = kind === "user" ? { token: FAKE_USER_TOKEN, cookie: FAKE_COOKIE } : { token: FAKE_BOT_TOKEN, app_token: FAKE_APP_TOKEN }
  return new SlackAdapter({
    account_id: FAKE_TEAM,
    token_kind: kind,
    ...secrets,
    apiBase: server.apiBase,
    chats: [FAKE_CHAT, FAKE_DM],
    clock: fastClock(),
    log: (line) => logs.push(line),
    ...overrides,
  })
}

export type Listening = {
  events: InboundEvent[]
  ready: Promise<void>
  done: Promise<unknown>
  waitFor(predicate: (event: InboundEvent) => boolean, what: string, ms?: number): Promise<InboundEvent>
  stop(): Promise<unknown>
}

/** Run `adapter.listen` in the background; `done` settles with null or the error listen rejected with. */
export function startListening(adapter: SlackAdapter): Listening {
  const events: InboundEvent[] = []
  const waiters = new Set<() => void>()
  const controller = new AbortController()
  const ready = Promise.withResolvers<void>()
  const done = adapter
    .listen(
      (event) => {
        events.push(event)
        for (const waiter of [...waiters]) waiter()
      },
      controller.signal,
      () => ready.resolve(),
    )
    .then(
      () => null,
      (error: unknown) => error,
    )
  const waitFor = (predicate: (event: InboundEvent) => boolean, what: string, ms = 5000) =>
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
        reject(new Error(`waited ${ms} ms for ${what}; got ${JSON.stringify(events.map((event) => [event.kind, event.text]))}`))
      }, ms)
      waiters.add(check)
      check()
    })
  return {
    events,
    ready: ready.promise,
    done,
    waitFor,
    stop: () => {
      controller.abort()
      return done
    },
  }
}
