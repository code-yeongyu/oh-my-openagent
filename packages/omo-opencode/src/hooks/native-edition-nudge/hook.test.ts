import { describe, expect, it } from "bun:test"

import {
  createNativeEditionNudgeHook,
  isInteractiveLaunch,
  NATIVE_NUDGE_TOAST_MESSAGE,
  NATIVE_NUDGE_TOAST_TITLE,
} from "./hook"
import type { NudgeState, NudgeStateRead, NudgeStateStore } from "./index"

type ToastCall = { body: { title: string; message: string; variant: string; duration: number } }

type TuiBehavior = "resolve" | "reject" | "throw-sync" | "never-settle" | "missing"

function nudgeState(decision: NudgeState["decision"]): NudgeState {
  return {
    schemaVersion: 1,
    autoShows: 0,
    lastShownAt: null,
    nextEligibleAt: 0,
    decision,
    decidedAt: null,
    writtenBy: "test",
  }
}

function fakeStore(state: NudgeStateRead): NudgeStateStore & { readonly writes: NudgeState[] } {
  const writes: NudgeState[] = []
  return {
    writes,
    read: () => writes.at(-1) ?? state,
    write: (next) => {
      writes.push(next)
      return true
    },
    probeWritable: () => true,
  }
}

function createCtx(options: {
  behavior?: TuiBehavior
  state?: NudgeStateRead
  nativeInstalled?: boolean
}) {
  const toasts: ToastCall[] = []
  const behavior = options.behavior ?? "resolve"
  const store = fakeStore(options.state ?? "missing")
  const nativeInstalled = options.nativeInstalled ?? false

  // The real SDK's showToast reads `this._client` (sdk.gen.js), so this mock does the same: an
  // unbound call fails exactly the way it fails against the real OpenCode client.
  const tui = {
    _client: { ready: true },
    showToast(arg: ToastCall) {
      if (this?._client?.ready !== true) {
        throw new TypeError("undefined is not an object (evaluating 'this._client')")
      }
      toasts.push(arg)
      if (behavior === "reject") return Promise.reject(new Error("tui unavailable"))
      if (behavior === "throw-sync") throw new Error("client disposed")
      if (behavior === "never-settle") return new Promise<never>(() => {})
      return Promise.resolve()
    },
  }

  const ctx = {
    client: behavior === "missing" ? {} : { tui },
    directory: "/tmp/test",
  } as unknown as Parameters<typeof createNativeEditionNudgeHook>[0]

  const deps = {
    store,
    detectNativeEdition: () => nativeInstalled,
    interactive: () => true,
  }
  return { ctx, deps, toasts, store }
}

function sessionCreated(parentID?: string) {
  return {
    event: {
      type: "session.created",
      properties: { info: parentID ? { parentID } : {} },
    },
  }
}

describe("createNativeEditionNudgeHook", () => {
  it("#given a top-level session #then recommends OmO Native with the omo.dev link", async () => {
    const { ctx, deps, toasts } = createCtx({})
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.body.title).toBe(NATIVE_NUDGE_TOAST_TITLE)
    expect(toasts[0]?.body.message).toBe(NATIVE_NUDGE_TOAST_MESSAGE)
    expect(toasts[0]?.body.message).toContain("https://omo.dev")
  })

  it("#given two session starts in one process #then the toast fires once per launch", async () => {
    const { ctx, deps, toasts } = createCtx({})
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())
    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(1)
  })

  it("#given a child session #then no toast fires", async () => {
    const { ctx, deps, toasts } = createCtx({})
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated("ses_parent"))

    expect(toasts).toHaveLength(0)
  })

  it("#given a non-session event #then no toast fires", async () => {
    const { ctx, deps, toasts } = createCtx({})
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event({ event: { type: "session.idle", properties: {} } })

    expect(toasts).toHaveLength(0)
  })

  it("#given a recorded never opt-out #then no toast fires and nothing is written", async () => {
    const { ctx, deps, toasts, store } = createCtx({ state: nudgeState("never") })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(0)
    expect(store.writes).toHaveLength(0)
  })

  it("#given a completed migration #then no toast fires", async () => {
    const { ctx, deps, toasts } = createCtx({ state: nudgeState("migrated") })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(0)
  })

  it("#given a snoozed decision #then the toast waits until the promised eligibility time", async () => {
    const nextEligibleAt = 7 * 24 * 60 * 60 * 1000
    let now = nextEligibleAt - 1
    const { ctx, deps, toasts, store } = createCtx({
      state: { ...nudgeState("snoozed"), nextEligibleAt },
    })
    const hook = createNativeEditionNudgeHook(ctx, { ...deps, now: () => now })

    await hook.event(sessionCreated())
    expect(toasts).toHaveLength(0)
    now = nextEligibleAt
    await hook.event(sessionCreated())
    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(1)
    expect(store.writes.map((write) => write.autoShows)).toEqual([1])
  })

  it("#given OmO Native already installed #then no toast fires", async () => {
    const { ctx, deps, toasts } = createCtx({ nativeInstalled: true })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(0)
  })

  it("#given no toast API #then the hook resolves without throwing", async () => {
    const { ctx, deps } = createCtx({ behavior: "missing" })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())
  })

  it("#given a rejecting toast API #then the hook resolves without throwing", async () => {
    const { ctx, deps } = createCtx({ behavior: "reject" })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())
  })

  it("#given a synchronously throwing toast API #then the hook resolves without throwing", async () => {
    const { ctx, deps } = createCtx({ behavior: "throw-sync" })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    await hook.event(sessionCreated())
  })

  it("#given a toast that never settles #then startup is not delayed", async () => {
    let settle: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      settle = resolve
    })
    const { ctx, deps, toasts } = createCtx({ behavior: "never-settle" })
    const hook = createNativeEditionNudgeHook(ctx, deps)

    const outcome = await Promise.race([
      hook.event(sessionCreated()).then(() => "event-resolved" as const),
      gate.then(() => "gate-elapsed" as const),
    ])
    settle?.()

    expect(outcome).toBe("event-resolved")
    expect(toasts).toHaveLength(1)
  })

  it("#given a CI or non-interactive launch #then no toast fires and nothing is recorded", async () => {
    const { ctx, deps, toasts, store } = createCtx({})
    const hook = createNativeEditionNudgeHook(ctx, { ...deps, interactive: () => false })

    await hook.event(sessionCreated())

    expect(toasts).toHaveLength(0)
    expect(store.writes).toHaveLength(0)
  })

  it("#given the launch environment #then CI, OMO_NON_INTERACTIVE and a non-TTY stdout count as non-interactive", () => {
    expect(isInteractiveLaunch({}, true)).toBe(true)
    expect(isInteractiveLaunch({ CI: "true" }, true)).toBe(false)
    expect(isInteractiveLaunch({ OMO_NON_INTERACTIVE: "1" }, true)).toBe(false)
    expect(isInteractiveLaunch({}, false)).toBe(false)
    expect(isInteractiveLaunch({}, undefined)).toBe(false)
  })

  it("#given a shown toast #then the show is recorded and the next launch waits for the interval", async () => {
    const start = 1_000_000
    const first = createCtx({})
    await createNativeEditionNudgeHook(first.ctx, { ...first.deps, now: () => start }).event(sessionCreated())
    expect(first.toasts).toHaveLength(1)
    const recorded = first.store.writes.at(-1)
    expect(recorded?.autoShows).toBe(1)
    expect(recorded?.lastShownAt).toBe(start)

    const nextLaunch = createCtx({ state: recorded })
    const before = recorded ? recorded.nextEligibleAt - 1 : start
    await createNativeEditionNudgeHook(nextLaunch.ctx, { ...nextLaunch.deps, now: () => before }).event(sessionCreated())
    expect(nextLaunch.toasts).toHaveLength(0)
  })
})
