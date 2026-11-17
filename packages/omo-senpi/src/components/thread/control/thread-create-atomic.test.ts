import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "../contracts"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { createdThreadId } from "./session-host"

// omo#14060: the connection to this device's host can close after the host made the session and before its reply
// arrived. thread_create must not leave a prompt-less thread behind: it finds the thread it made by the id the call's
// idempotency key derives, on the spot or on a retry under the same key, and admits the prompt exactly once.
const { surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Created = Extract<ThreadToolResult, { kind: "ok" }> & {
  thread: { thread_id: string }
  prompt?: Record<string, unknown>
}

describe("thread_create survives a lost open reply (#14060)", () => {
  test("#given the host makes the session but the reply is lost #when thread_create runs with a prompt #then it answers that thread and admits the prompt once", async () => {
    const { run, openSession, enqueuedFor } = surface(undefined, { openLosesReply: 1 })
    const result = (await run("thread_create", {
      name: "lost-reply",
      prompt: "build it",
      idempotency_key: "atomic-1",
    })) as Created
    const id = createdThreadId("dur-caller", "atomic-1")
    expect(result).toMatchObject({ kind: "ok", thread: { thread_id: id } })
    expect(result.prompt).toMatchObject({ delivery: { kind: expect.any(String) } })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(enqueuedFor(id)).toBe(1)
  })

  test("#given the lost reply also fails the call #when it is retried under the same key #then the retry answers the same thread, opens nothing new and admits the prompt once", async () => {
    const { run, openSession, enqueuedFor } = surface(undefined, { openLosesReply: 1, listFailsAfterLostReply: true })
    const args = { name: "lost-twice", prompt: "build it", idempotency_key: "atomic-2" }
    const first = await run("thread_create", args)
    expect(first).toMatchObject({ kind: "error" })
    const id = createdThreadId("dur-caller", "atomic-2")
    expect(enqueuedFor(id)).toBe(0)
    const retry = (await run("thread_create", args)) as Created
    expect(retry).toMatchObject({ kind: "ok", thread: { thread_id: id } })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(enqueuedFor(id)).toBe(1)
    const again = (await run("thread_create", args)) as Created
    // A third run under the key finds the same thread; the prompt's own receipt answers it as already delivered.
    expect(again).toMatchObject({ kind: "ok", thread: { thread_id: id }, prompt: { deduplicated: true } })
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  test("#given two creates under different keys #when both run #then each derives its own id", () => {
    expect(createdThreadId("dur-caller", "a")).not.toBe(createdThreadId("dur-caller", "b"))
    expect(createdThreadId("dur-caller", "a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
