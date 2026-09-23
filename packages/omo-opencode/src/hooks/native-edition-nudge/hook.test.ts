import { describe, expect, test } from "bun:test"

import { createNativeEditionNudgeHook, NATIVE_NUDGE_TOAST_MESSAGE, NATIVE_NUDGE_TOAST_TITLE } from "./hook"
import type { NudgeStateStore } from "./state"
import { NUDGE_STATE_VERSION, type NudgeState, type NudgeStateRead } from "./types"

const NOW = 1_700_000_000_000

type ToastCall = { title: string; message: string }

function fakeCtx(overrides: { toastAvailable?: boolean; onToast?: () => void } = {}) {
  const toasts: ToastCall[] = []
  const showToast = async (input: { body: { title: string; message: string } }) => {
    overrides.onToast?.()
    toasts.push({ title: input.body.title, message: input.body.message })
  }
  const ctx = {
    client: { tui: overrides.toastAvailable === false ? {} : { showToast } },
  } as unknown as Parameters<typeof createNativeEditionNudgeHook>[0]
  return { ctx, toasts }
}

function fakeStore(initial: NudgeStateRead, options: { writable?: boolean; writeFails?: boolean } = {}) {
  let current = initial
  const writes: NudgeState[] = []
  const store: NudgeStateStore = {
    read: () => current,
    write: (state) => {
      if (options.writeFails === true) return false
      writes.push(state)
      current = state
      return true
    },
    probeWritable: () => options.writable !== false,
  }
  return { store, writes }
}

function hookFor(
  ctxAndToasts: ReturnType<typeof fakeCtx>,
  store: NudgeStateStore,
  deps: { installed?: boolean; childSession?: boolean } = {},
) {
  return createNativeEditionNudgeHook(ctxAndToasts.ctx, {
    store,
    detectNativeEdition: () => deps.installed === true,
    now: () => NOW,
    interactive: () => true,
    version: "test",
  })
}

function sessionCreated(parentID?: string) {
  return { event: { type: "session.created", properties: { info: parentID === undefined ? {} : { parentID } } } }
}

describe("the nudge reaches the real toast surface", () => {
  test("#given an eligible first session #when the event fires #then exactly one toast carries the install command", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing")

    // when
    await hookFor(surface, store).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(1)
    expect(surface.toasts[0]?.title).toBe(NATIVE_NUDGE_TOAST_TITLE)
    expect(surface.toasts[0]?.message).toBe(NATIVE_NUDGE_TOAST_MESSAGE)
    expect(surface.toasts[0]?.message).toContain("bun add -g omo-ai@beta")
  })

  test("#given repeated session events in one process #when they fire #then the toast is shown exactly once", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing")
    const hook = hookFor(surface, store)

    // when
    await hook.event(sessionCreated())
    await hook.event(sessionCreated())
    await hook.event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(1)
  })

  test("#given a non-session event #when it fires #then nothing is shown", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing")

    // when
    await hookFor(surface, store).event({ event: { type: "session.idle", properties: {} } })

    // then
    expect(surface.toasts).toHaveLength(0)
  })
})

describe("the nudge stays silent for a user who cannot act on it", () => {
  test("#given the native edition is already installed #when the event fires #then nothing is shown", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing")

    // when
    await hookFor(surface, store, { installed: true }).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(0)
  })

  test("#given a child session #when the event fires #then nothing is shown", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing")

    // when
    await hookFor(surface, store).event(sessionCreated("parent-1"))

    // then
    expect(surface.toasts).toHaveLength(0)
  })

  test("#given the user said never #when the event fires #then nothing is shown", async () => {
    // given
    const surface = fakeCtx()
    const state: NudgeState = {
      schemaVersion: NUDGE_STATE_VERSION,
      autoShows: 0,
      lastShownAt: null,
      nextEligibleAt: NOW,
      decision: "never",
      decidedAt: NOW,
      writtenBy: "test",
    }
    const { store } = fakeStore(state)

    // when
    await hookFor(surface, store).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(0)
  })

  test("#given the toast API is unavailable #when the event fires #then nothing is shown and no state is claimed", async () => {
    // given
    const surface = fakeCtx({ toastAvailable: false })
    const { store, writes } = fakeStore("missing")

    // when
    await hookFor(surface, store).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })
})

describe("a nudge that cannot be recorded is never shown", () => {
  test("#given the state write fails #when the event fires #then the toast is suppressed", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing", { writeFails: true })

    // when
    await hookFor(surface, store).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(0)
  })

  test("#given an unwritable state directory #when the event fires #then the toast is suppressed", async () => {
    // given
    const surface = fakeCtx()
    const { store } = fakeStore("missing", { writable: false })

    // when
    await hookFor(surface, store).event(sessionCreated())

    // then
    expect(surface.toasts).toHaveLength(0)
  })
})
