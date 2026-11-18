import { describe, expect, test } from "bun:test"
import type { RemoteSessionRow, RemoteThreadSurface, RemoteWatchOutcome } from "../remote/ports"
import { createRelayControl } from "./relay-control"

const ROW: RemoteSessionRow = {
  device: "b",
  session_id: "rk-on-b",
  title: "",
  project: "",
  path: "",
  state: "running",
  updated_ms: 0,
}

// A device whose watch never answers (an attach or baseline read that hangs); `stopped` counts watches stopped later.
function hangingRemote() {
  const state = { stopped: 0, release: (_outcome: RemoteWatchOutcome) => {} }
  const remote = {
    sessions: {
      watch: () =>
        new Promise<RemoteWatchOutcome>((resolve) => {
          state.release = resolve
        }),
    },
    chain: { stamp: (record: Readonly<Record<string, unknown>>) => record },
  } as unknown as RemoteThreadSurface
  return { remote, state }
}

describe("thread_read wait on another device: deadline and abort cover the attach (#13743 review M1, L1)", () => {
  test("#given a watch whose attach never answers #when wait_ms passes #then the wait times out at its bound", async () => {
    const { remote } = hangingRemote()
    const outcome = await createRelayControl(remote, ROW).waitSettled(50, undefined)
    expect(outcome).toMatchObject({ outcome: "timeout" })
  })

  test("#given a watch whose attach never answers #when the caller aborts #then the wait is cancelled, and the watch that answers later is stopped", async () => {
    const { remote, state } = hangingRemote()
    const controller = new AbortController()
    const waiting = createRelayControl(remote, ROW).waitSettled(60_000, controller.signal)
    controller.abort()
    expect(await waiting).toMatchObject({ outcome: "cancelled" })
    let stopped!: () => void
    const stoppedOnce = new Promise<void>((resolve) => {
      stopped = resolve
    })
    state.release({
      kind: "ok",
      watch: {
        ended: new Promise(() => {}),
        stop: () => {
          state.stopped += 1
          stopped()
        },
      },
    })
    await stoppedOnce
    expect(state.stopped).toBe(1)
  })

  test("#given a watch that fails after the wait timed out #when it rejects #then the rejection is handled and nothing escapes", async () => {
    let fail: (error: Error) => void = () => {}
    const remote = {
      sessions: {
        watch: () =>
          new Promise<RemoteWatchOutcome>((_resolve, reject) => {
            fail = reject
          }),
      },
      chain: { stamp: (record: Readonly<Record<string, unknown>>) => record },
    } as unknown as RemoteThreadSurface
    const escaped: unknown[] = []
    const onUnhandled = (reason: unknown) => escaped.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      expect(await createRelayControl(remote, ROW).waitSettled(20, undefined)).toMatchObject({ outcome: "timeout" })
      fail(new Error("runtime load failed"))
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(escaped).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test.each(["auto_retry_start", "auto_retry_end"])(
    "#given a %s record #when the session then reads idle #then the wait settles on the retried run's turn",
    async (type) => {
      type Handlers = Parameters<RemoteThreadSurface["sessions"]["watch"]>[2]
      const opened = Promise.withResolvers<Handlers>()
      const remote = {
        sessions: {
          watch: async (_device: string, _sessionId: string, handlers: Handlers) => {
            opened.resolve(handlers)
            return {
              kind: "ok",
              watch: { ended: new Promise(() => {}), initial: { status: "idle" }, stop: () => {} },
            }
          },
        },
        chain: { stamp: (entry: Readonly<Record<string, unknown>>) => entry },
      } as unknown as RemoteThreadSurface
      const waiting = createRelayControl(remote, ROW).waitSettled(5_000, undefined)
      const handlers = await opened.promise
      // Without the retry counted as the run's own, the idle status reads as no run at all and the wait settles on its
      // quiet window with no turn.
      handlers.record({ type, turnId: "retry-turn" })
      handlers.status?.({ from: undefined, to: "idle", derived: true })
      expect(await waiting).toMatchObject({ outcome: "settled", status: "idle", turn_id: "retry-turn" })
    },
  )
})
