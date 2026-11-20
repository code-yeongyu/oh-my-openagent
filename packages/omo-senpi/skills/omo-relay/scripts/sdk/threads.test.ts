import { describe, expect, test } from "bun:test"
import { onEveryThread, onThreads, readThreads, sendToThreads, ThreadListError } from "./index.ts"
import type { PortAnswer, ThreadPort, ThreadReadValue, ThreadSendValue } from "./ports.ts"

function fakeThreads(overrides: Partial<ThreadPort> = {}): ThreadPort & { readonly sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    list: async () => ({
      kind: "ok",
      threads: [
        { thread: "t-1", name: "one" },
        { thread: "t-2", name: "two", machine: "device-b" },
      ],
    }),
    read: async (thread): Promise<PortAnswer<ThreadReadValue>> => ({
      kind: "ok",
      thread,
      items: [{ text: `pong from ${thread}` }],
    }),
    send: async (thread, message): Promise<PortAnswer<ThreadSendValue>> => {
      sent.push(`${thread}:${message}`)
      if (thread === "t-missing")
        return {
          kind: "error",
          error: { code: "not_found", message: "no such thread", next_action: "call thread_list" },
        }
      return { kind: "ok", thread }
    },
    ...overrides,
  }
}

describe("sendToThreads", () => {
  test("#given a target whose send answers an error #when sent #then it is rejected with that error and the others deliver", async () => {
    // given
    const threads = fakeThreads()

    // when
    const batch = await sendToThreads(threads, ["t-1", "t-missing", "t-2"], "status", { all_scope: true })

    // then
    expect(batch.outcomes.map((outcome) => outcome.kind)).toEqual(["fulfilled", "rejected", "fulfilled"])
    expect(batch.rejected[0]?.error).toEqual({
      code: "not_found",
      message: "no such thread",
      next_action: "call thread_list",
    })
    expect(threads.sent).toEqual(["t-1:status", "t-missing:status", "t-2:status"])
  })
})

describe("onThreads", () => {
  test("#given a callback that throws for one thread #when run with a concurrency cap #then that thread is rejected and order holds", async () => {
    // given
    let inFlight = 0
    let peak = 0
    const op = async (thread: string): Promise<PortAnswer<{ readonly thread: string }>> => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      if (thread === "b") throw new TypeError("bad callback")
      return { kind: "ok", thread }
    }

    // when
    const batch = await onThreads(["a", "b", "c", "d"], op, { concurrency: 2 })

    // then
    expect(batch.outcomes.map((outcome) => [outcome.target, outcome.kind])).toEqual([
      ["a", "fulfilled"],
      ["b", "rejected"],
      ["c", "fulfilled"],
      ["d", "fulfilled"],
    ])
    expect(batch.rejected[0]?.error.code).toBe("callback_failed")
    expect(peak).toBe(2)
  })
})

describe("readThreads", () => {
  test("#given two threads #when read #then each answer is fulfilled with its items", async () => {
    // when
    const batch = await readThreads(fakeThreads(), ["t-1", "t-2"], { wait_ms: 1000 })

    // then
    expect(batch.ok).toBe(true)
    expect(batch.fulfilled.map((outcome) => outcome.value.items)).toEqual([
      [{ text: "pong from t-1" }],
      [{ text: "pong from t-2" }],
    ])
  })
})

describe("onEveryThread", () => {
  test("#given a listed account #when run #then the op runs once per row with the row as target", async () => {
    // when
    const batch = await onEveryThread(fakeThreads(), async (row) => ({ kind: "ok", name: row.name }))

    // then
    expect(batch.fulfilled.map((outcome) => [outcome.target.thread, outcome.value.name])).toEqual([
      ["t-1", "one"],
      ["t-2", "two"],
    ])
  })

  test("#given a list that fails #when run #then it rejects with the list's code and nothing runs", async () => {
    // given
    const threads = fakeThreads({
      list: async () => ({
        kind: "error",
        error: { code: "host_unavailable", message: "down", next_action: "retry later" },
      }),
    })
    let ran = 0

    // when
    const run = onEveryThread(threads, async () => {
      ran += 1
      return { kind: "ok" }
    })

    // then
    await expect(run).rejects.toBeInstanceOf(ThreadListError)
    expect(ran).toBe(0)
  })
})
