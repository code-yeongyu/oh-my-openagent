import { afterEach, describe, expect, test } from "bun:test"

import type { CallWaitOptions, WaitClock } from "../call-budget/call-deadline"
import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createRemoteThreadFixture } from "./thread-remote-fixture"
import type { ThreadHost } from "./tools"

// Slice T1b: every thread control on the root honours the call's wait options. Before the control's write is sent, an
// abort answers cancelled and a passed deadline timeout, and nothing is sent; once the write was sent, a lost wait answers
// idempotency_uncertain and a repeat under the same key acts no second time. Time is a virtual clock; nothing sleeps.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const WRITES = new Set([
  "interrupt",
  "closeSession",
  "unloadSession",
  "setSessionName",
  "setModel",
  "setThinkingLevel",
  "setSessionArchived",
])

type Hooks = { onRead?: () => void; holdWrite?: () => void }

function virtualClock() {
  let now = Date.now()
  const timers = new Set<{ readonly at: number; readonly fire: () => void }>()
  const clock: WaitClock = {
    now: () => now,
    after: (ms, fire) => {
      const timer = { at: now + ms, fire }
      timers.add(timer)
      return () => timers.delete(timer)
    },
  }
  const advance = (ms: number): void => {
    now += ms
    for (const timer of [...timers].filter((candidate) => candidate.at <= now)) {
      timers.delete(timer)
      timer.fire()
    }
  }
  return { clock, advance }
}

// This device's host, counting the controls' writes; a hook runs at the first listing (a read before any write) or holds
// the first write unanswered after running, so the wait is lost while the write is in flight.
function hooked(host: ThreadHost, hooks: Hooks, writes: string[]): ThreadHost {
  return new Proxy(host, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof value !== "function" || typeof key !== "string") return value
      if (key === "getAvailableModels") return async () => [{ provider: "anthropic", id: "m-1" }]
      return (...args: unknown[]) => {
        if (key === "listSessions" && hooks.onRead !== undefined) {
          const read = hooks.onRead
          hooks.onRead = undefined
          read()
        }
        if (WRITES.has(key)) {
          writes.push(key)
          const hold = hooks.holdWrite
          if (hold !== undefined) {
            hooks.holdWrite = undefined
            hold()
            return new Promise(() => undefined)
          }
        }
        return Reflect.apply(value, target, args)
      }
    },
  })
}

function world() {
  const a = account()
  const s = surface(a.remote)
  const hooks: Hooks = {}
  const writes: string[] = []
  const time = virtualClock()
  const root = assembleOmoSdk(
    {
      agentDir: s.agentDir,
      cwd: process.cwd(),
      uid: 501,
      user: "qa",
      ports: { host: hooked(s.host, hooks, writes), store: s.store, remote: a.remote, waitClock: time.clock },
    },
    {},
  )
  return { root, hooks, writes, time }
}

type Root = ReturnType<typeof world>["root"]
type Key = { readonly idempotency_key?: string }

const CONTROLS: readonly (readonly [string, (root: Root, key: Key, wait?: CallWaitOptions) => Promise<unknown>])[] = [
  ["interrupt", (root, key, wait) => root.threads.interrupt({ thread: "dur-local", ...key }, wait)],
  ["close", (root, key, wait) => root.threads.close({ thread: "dur-local", ...key }, wait)],
  ["unload", (root, key, wait) => root.threads.unload({ thread: "dur-local", ...key }, wait)],
  [
    "setModel",
    (root, key, wait) => root.threads.setModel({ thread: "dur-local", model: "anthropic/m-1", ...key }, wait),
  ],
  [
    "setReasoning",
    (root, key, wait) => root.threads.setReasoning({ thread: "dur-local", level: "high", ...key }, wait),
  ],
  ["rename", (root, key, wait) => root.threads.rename({ thread: "dur-local", name: "renamed", ...key }, wait)],
  ["archive", (root, key, wait) => root.threads.archive({ thread: "dur-local", ...key }, wait)],
]

const codeOf = (answer: unknown): unknown => (answer as { error?: { code?: unknown } }).error?.code
const timeless = (answer: unknown) => ({ ...(answer as object), created_at: "<time>", updated_at: "<time>" })

describe("a thread control's wait options on the root (slice T1b)", () => {
  test.each(CONTROLS)(
    "#given %s whose signal aborts while it reads #then cancelled and no write",
    async (_name, call) => {
      const { root, hooks, writes } = world()
      const controller = new AbortController()
      hooks.onRead = () => controller.abort()
      expect(codeOf(await call(root, {}, { signal: controller.signal }))).toBe("cancelled")
      expect(writes).toEqual([])
    },
  )

  test.each(CONTROLS)(
    "#given %s whose deadline passes while it reads #then timeout and no write",
    async (_name, call) => {
      const { root, hooks, writes, time } = world()
      hooks.onRead = () => time.advance(1_001)
      const answer = await call(root, {}, { deadline_ms: 1_000 })
      expect(answer).toMatchObject({ kind: "error", error: { code: "timeout", details: { deadline_ms: 1_000 } } })
      expect(writes).toEqual([])
    },
  )

  test.each(CONTROLS)(
    "#given %s whose signal aborts after its write was sent #then idempotency_uncertain, and a repeat under the key writes no second time",
    async (name, call) => {
      const { root, hooks, writes } = world()
      const controller = new AbortController()
      hooks.holdWrite = () => controller.abort()
      const key = { idempotency_key: `k-${name}` }
      const lost = await call(root, key, { signal: controller.signal })
      expect(lost).toMatchObject({
        kind: "error",
        error: { code: "idempotency_uncertain", details: { reason: "cancelled" } },
      })
      expect(writes).toHaveLength(1)
      expect(codeOf(await call(root, key))).toBe("idempotency_uncertain")
      expect(writes).toHaveLength(1)
    },
  )

  test.each(CONTROLS)(
    "#given %s with a wait it never loses #then the same answer as without options",
    async (_name, call) => {
      const withWait = await call(world().root, {}, { signal: new AbortController().signal, deadline_ms: 60_000 })
      const without = await call(world().root, {})
      expect(timeless(withWait)).toEqual(timeless(without))
      expect(withWait).toMatchObject({ kind: "ok" })
    },
  )
})
