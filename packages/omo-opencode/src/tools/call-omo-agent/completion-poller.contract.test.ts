import * as timers from "node:timers"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { waitForCompletion } from "./completion-poller"

const originalNow = Date.now
const originalTimeout = globalThis.setTimeout
let elapsed = 0
beforeEach(() => {
  elapsed = 0
  Date.now = () => elapsed
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => {
    elapsed += delay ?? 0
    if (typeof handler === "function") handler()
    return 0
  }) as typeof globalThis.setTimeout
})
afterEach(() => {
  Date.now = originalNow
  globalThis.setTimeout = originalTimeout
})

function context(messages: ReturnType<typeof mock>, status: ReturnType<typeof mock> = mock(async () => ({ data: {} }))) {
  return { client: { session: { messages, status } } } as unknown as Parameters<typeof waitForCompletion>[2]
}
function toolContext(abort: AbortSignal) {
  return { sessionID: "parent", messageID: "parent-message", agent: "sisyphus", abort }
}
const user = { info: { id: "msg_001", role: "user" } }
const complete = { info: { id: "msg_002", role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "done" }] }

describe("completion evidence", () => {
  for (const [name, history] of [
    ["user-only history", [user]],
    ["unfinished assistant", [user, { info: { id: "msg_002", role: "assistant" } }]],
    ["tool-call assistant", [user, { info: { id: "msg_002", role: "assistant", finish: "tool-calls" } }]],
    ["unknown finish", [user, { info: { id: "msg_002", role: "assistant", finish: "unknown" } }]],
    ["pending tool despite stop", [user, { ...complete, parts: [{ type: "tool" }] }]],
    ["old completed reply before new user", [complete, { info: { id: "msg_003", role: "user" } }]],
  ] as const) {
    test(`#given ${name} #when history stays unchanged #then it waits for the terminal reply`, async () => {
      // given
      let reads = 0
      const messages = mock(async () => ({ data: ++reads < 6 ? history : [user, complete] }))
      // when
      await waitForCompletion("child", toolContext(new AbortController().signal), context(messages))
      // then
      expect(reads).toBeGreaterThanOrEqual(6)
    })
  }

  test("#given a reused session has an old reply #when a new prompt is not yet saved #then it waits for the new turn", async () => {
    // given
    let reads = 0
    const messages = mock(async () => ({ data: ++reads < 6 ? [user, complete] : [user, complete, { info: { id: "msg_003", role: "user" } }, { ...complete, info: { ...complete.info, id: "msg_004" } }] }))
    // when
    await waitForCompletion("child", toolContext(new AbortController().signal), context(messages), "msg_002")
    // then
    expect(reads).toBeGreaterThanOrEqual(6)
  })

  test("#given a terminal assistant error #when idle #then it preserves the failure", async () => {
    // given
    const messages = mock(async () => ({ data: [user, { info: { id: "msg_002", role: "assistant", error: { data: { message: "provider failed" } } } }] }))
    // when / then
    await expect(waitForCompletion("child", toolContext(new AbortController().signal), context(messages)))
      .rejects.toThrow("provider failed")
    expect(messages).toHaveBeenCalledTimes(1)
  })

  test("#given a resumed assistant fails after the anchor #when idle #then it preserves the new turn failure", async () => {
    // given
    const messages = mock(async () => ({ data: [user, complete, { info: { id: "msg_003", role: "user" } }, { info: { id: "msg_004", role: "assistant", error: { data: { message: "resumed provider failed" } } } }] }))
    // when / then
    await expect(waitForCompletion("child", toolContext(new AbortController().signal), context(messages), "msg_002"))
      .rejects.toThrow("resumed provider failed")
    expect(messages).toHaveBeenCalledTimes(1)
  })

  for (const endpoint of ["status", "messages"] as const) {
    test(`#given a pending ${endpoint} request #when the parent aborts #then polling cancels without another request`, async () => {
      // given
      const controller = new AbortController()
      let release!: (value: never) => void
      const stalled = mock(() => new Promise((resolve) => { release = resolve }))
      const messages = endpoint === "messages" ? stalled : mock(async () => ({ data: [user, complete] }))
      const status = endpoint === "status" ? stalled : mock(async () => ({ data: {} }))
      const result = waitForCompletion("child", toolContext(controller.signal), context(messages, status))
      const observed = result.then(() => "resolved", (error: Error) => error.message)
      for (let i = 0; i < 5; i++) await Promise.resolve()
      // when
      controller.abort()
      const outcome = await Promise.race([observed, new Promise<string>((resolve) => timers.setTimeout(() => resolve("still pending"), 20))])
      // then
      release({ data: endpoint === "status" ? {} : [user, complete] } as never)
      await observed
      expect(outcome).toBe("Task aborted.")
      expect(stalled).toHaveBeenCalledTimes(1)
    })
  }

  test("#given the operation deadline fires #when polling #then it cancels with the named timeout", async () => {
    // given
    const timeout = spyOn(timers, "setTimeout").mockImplementation(((handler: () => void) => {
      queueMicrotask(handler)
      return originalTimeout(() => {}, 0)
    }) as typeof timers.setTimeout)
    const messages = mock(async () => ({ data: [user, complete] }))
    try {
      // when / then
      await expect(waitForCompletion("child", toolContext(new AbortController().signal), context(messages)))
        .rejects.toThrow("Agent task timed out after 5 minutes.")
      expect(timeout.mock.calls[0]?.[1]).toBe(300_000)
    } finally {
      timeout.mockRestore()
    }
  })

  for (const outcome of ["success", "SDK throw"] as const) {
    test(`#given ${outcome} #when polling settles #then it clears the deadline and parent listener`, async () => {
      // given
      const controller = new AbortController()
      const remove = spyOn(controller.signal, "removeEventListener")
      const clear = spyOn(timers, "clearTimeout")
      const status = mock(async () => {
        if (outcome === "SDK throw") throw new Error("sync SDK failure")
        return { data: {} }
      })
      try {
        // when
        const result = waitForCompletion("child", toolContext(controller.signal), context(mock(async () => ({ data: [user, complete] })), status))
        if (outcome === "success") await result
        else await expect(result).rejects.toThrow("sync SDK failure")
        // then
        expect(clear).toHaveBeenCalledTimes(1)
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
      } finally {
        clear.mockRestore()
        remove.mockRestore()
      }
    })
  }

  test("#given an SDK message error #when polling #then it reports the actual error promptly", async () => {
    // given
    const messages = mock(async () => ({ error: { name: "NotFoundError", message: "child session missing" } }))
    // when / then
    await expect(waitForCompletion("child", toolContext(new AbortController().signal), context(messages)))
      .rejects.toThrow("child session missing")
    expect(messages).toHaveBeenCalledTimes(1)
  })

  test("#given an SDK status error #when polling #then it does not infer idle completion", async () => {
    // given
    const status = mock(async () => ({ error: { message: "status unavailable" } }))
    const messages = mock(async () => ({ data: [user, complete] }))
    // when / then
    await expect(waitForCompletion("child", toolContext(new AbortController().signal), context(messages, status)))
      .rejects.toThrow("status unavailable")
    expect(messages).not.toHaveBeenCalled()
  })
})
