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
    "#given %s record arrives #when an idle snapshot follows #then the retry keeps the wait open",
    async (type) => {
      let record: Parameters<RemoteThreadSurface["sessions"]["watch"]>[2]["record"] = () => {}
      const remote = {
        sessions: {
          watch: async (
            _device: string,
            _sessionId: string,
            handlers: Parameters<RemoteThreadSurface["sessions"]["watch"]>[2],
          ) => {
            record = handlers.record
            return {
              kind: "ok",
              watch: { ended: new Promise(() => {}), initial: { status: "idle" }, stop: () => {} },
            }
          },
        },
        chain: { stamp: (entry: Readonly<Record<string, unknown>>) => entry },
      } as unknown as RemoteThreadSurface
      const waiting = createRelayControl(remote, ROW).waitSettled(5_000, undefined)
      record({ type, turnId: "retry-turn" })
      await new Promise<void>((resolve) => setTimeout(resolve, 3_050))
      record({ type: "agent_settled", turnId: "retry-turn" })
      expect(await waiting).toMatchObject({ outcome: "settled", turn_id: "retry-turn" })
    },
  )
})
