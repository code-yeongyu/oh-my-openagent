/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createOpenVikingLifecycle, type OpenVikingCall } from "./openviking"

describe("OpenViking lifecycle", () => {
  test("#given two active sessions #when assistant turns and compaction occur #then captures only assistant content and commits each session independently", async () => {
    // given
    const calls: Array<{ readonly operation: string; readonly sessionId: string; readonly content?: string }> = []
    const lifecycle = createOpenVikingLifecycle({
      threshold: 2,
      transport: async (call) => {
        calls.push(call)
        return { context: "remembered" }
      },
    })

    // when
    await lifecycle.start("one")
    await lifecycle.start("two")
    await lifecycle.capture("one", "user", "private input")
    await lifecycle.capture("one", "assistant", "first answer")
    await lifecycle.capture("one", "assistant", "second answer")
    await lifecycle.compact("two")

    // then
    expect(calls.filter((call) => call.operation === "capture")).toEqual([
      { operation: "capture", sessionId: "one", content: "first answer" },
      { operation: "capture", sessionId: "one", content: "second answer" },
    ])
    expect(calls.filter((call) => call.operation === "commit").map((call) => call.sessionId)).toEqual(["one", "two"])
  })

  test("#given profile resume and recall context #when a session starts and a turn is recalled #then returns both context layers", async () => {
    // given
    const lifecycle = createOpenVikingLifecycle({
      threshold: 10,
      transport: async (call) => ({
        context: call.operation === "profile" ? "profile" : call.operation === "recall" ? `recall:${call.content ?? "start"}` : undefined,
      }),
    })

    // when
    const initial = await lifecycle.start("one")
    const turn = await lifecycle.recall("one", "current question")

    // then
    expect(initial).toBe("profile\n\nrecall:start")
    expect(turn).toBe("recall:current question")
  })

  test("#given a duplicate assistant event #when captured twice #then sends and counts the event once", async () => {
    // given
    const calls: OpenVikingCall[] = []
    const lifecycle = createOpenVikingLifecycle({
      threshold: 2,
      transport: async (call) => {
        calls.push(call)
        return {}
      },
    })

    // when
    await lifecycle.capture("one", "assistant", "answer", "message-1")
    await lifecycle.capture("one", "assistant", "answer", "message-1")

    // then
    expect(calls.filter((call) => call.operation === "capture")).toHaveLength(1)
    expect(calls.filter((call) => call.operation === "commit")).toHaveLength(0)
  })

  test("#given a retryable capture failure #when retries flush #then records the capture and commits at the threshold", async () => {
    // given
    const calls: OpenVikingCall[] = []
    let captureAttempts = 0
    const lifecycle = createOpenVikingLifecycle({
      threshold: 1,
      transport: async (call) => {
        calls.push(call)
        if (call.operation === "capture" && captureAttempts++ === 0) throw new Error("temporary")
        return {}
      },
    })

    // when
    await lifecycle.capture("one", "assistant", "answer", "message-1")
    await lifecycle.flushRetries()

    // then
    expect(calls.map((call) => call.operation)).toEqual(["capture", "capture", "commit"])
  })

  test("#given a permanent transport failure #when retries are exhausted #then lifecycle calls remain nonblocking", async () => {
    // given
    let attempts = 0
    const lifecycle = createOpenVikingLifecycle({
      threshold: 1,
      transport: async () => {
        attempts += 1
        throw new Error("permanent")
      },
    })

    // when
    await expect(lifecycle.capture("one", "assistant", "answer", "message-1")).resolves.toBeUndefined()
    await expect(lifecycle.flushRetries()).resolves.toBeUndefined()
    await expect(lifecycle.flushRetries()).resolves.toBeUndefined()

    // then
    expect(attempts).toBe(3)
  })

  test("#given an uncommitted assistant capture #when the session shuts down #then commits before discarding session state", async () => {
    // given
    const calls: OpenVikingCall[] = []
    const lifecycle = createOpenVikingLifecycle({
      threshold: 10,
      transport: async (call) => {
        calls.push(call)
        return {}
      },
    })
    await lifecycle.capture("one", "assistant", "answer", "message-1")

    // when
    await lifecycle.shutdown("one")

    // then
    expect(calls.map((call) => call.operation)).toEqual(["capture", "commit"])
  })
})
