import { describe, expect, test } from "bun:test"

import { HerdrClient, herdrSocketTarget, type HerdrSocketLike } from "./client"

interface FakeSocketOptions {
  readonly respond?: (request: Record<string, unknown>) => Record<string, unknown> | undefined
}

function fakeConnect(
  requests: Record<string, unknown>[],
  options: FakeSocketOptions = {},
): (target: string) => HerdrSocketLike {
  return () => {
    const listeners = new Map<string, ((arg?: unknown) => void)[]>()
    const emit = (event: string, arg?: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(arg)
    }
    return {
      on(event, listener) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
      },
      write(chunk) {
        requests.push(JSON.parse(chunk.trim()) as Record<string, unknown>)
      },
      destroy() {},
    } satisfies HerdrSocketLike & {}
  }
}

// The socket lifecycle: "connect" then the request is written, then a "data" reply arrives.
function answeringConnect(
  requests: Record<string, unknown>[],
  answer: (request: Record<string, unknown>) => Record<string, unknown> | undefined,
): (target: string) => HerdrSocketLike {
  return () => {
    const listeners = new Map<string, ((arg?: unknown) => void)[]>()
    const emit = (event: string, arg?: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(arg)
    }
    const socket: HerdrSocketLike = {
      on(event, listener) {
        const list = listeners.get(event) ?? []
        list.push(listener)
        listeners.set(event, list)
      },
      write(chunk) {
        const request = JSON.parse(chunk.trim()) as Record<string, unknown>
        requests.push(request)
        const response = answer(request)
        if (response !== undefined) queueMicrotask(() => emit("data", `${JSON.stringify(response)}\n`))
      },
      destroy() {},
    }
    queueMicrotask(() => emit("connect"))
    return socket
  }
}

describe("HerdrClient", () => {
  test("#given a healthy socket #then the request carries id, method, pane_id, source and seq", async () => {
    const requests: Record<string, unknown>[] = []
    const client = new HerdrClient("/sock", "pane-3", {
      connect: answeringConnect(requests, (request) => ({ id: request.id, result: {} })),
      now: () => 1_700_000_000_000,
    })
    await client.send("pane.report_agent", { agent: "omo", state: "idle" })
    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request.method).toBe("pane.report_agent")
    expect(request.id).toMatch(/^custom:omo:/)
    const params = request.params as Record<string, unknown>
    expect(params.pane_id).toBe("pane-3")
    expect(params.source).toBe("custom:omo")
    expect(params.agent).toBe("omo")
    expect(params.state).toBe("idle")
    expect(typeof params.seq).toBe("number")
  })

  test("#given two sends #then seq strictly increases", async () => {
    const requests: Record<string, unknown>[] = []
    const client = new HerdrClient("/sock", "p", {
      connect: answeringConnect(requests, (request) => ({ id: request.id, result: {} })),
      now: () => 1,
    })
    await client.send("pane.report_agent", {})
    await client.send("pane.report_agent", {})
    const seqs = requests.map((request) => (request.params as Record<string, unknown>).seq as number)
    expect(seqs[1]).toBeGreaterThan(seqs[0])
  })

  test("#given an unanswered first attempt #then the request is retried once then rejected", async () => {
    const requests: Record<string, unknown>[] = []
    let attempts = 0
    const client = new HerdrClient("/sock", "p", {
      connect: answeringConnect(requests, (request) => {
        attempts++
        return attempts === 1 ? undefined : { id: request.id, result: {} }
      }),
      firstAttemptTimeoutMs: 5,
      secondAttemptTimeoutMs: 50,
    })
    await client.send("pane.report_agent", {})
    expect(attempts).toBe(2)
    expect(requests).toHaveLength(2)
  })

  test("#given a socket that never answers #then send rejects instead of hanging", async () => {
    const requests: Record<string, unknown>[] = []
    const client = new HerdrClient("/sock", "p", {
      connect: answeringConnect(requests, () => undefined),
      firstAttemptTimeoutMs: 5,
      secondAttemptTimeoutMs: 5,
    })
    await expect(client.send("pane.report_agent", {})).rejects.toThrow(/two attempts/)
    expect(requests).toHaveLength(2)
  })

  test("#given a throwing connect #then send rejects after both attempts", async () => {
    const client = new HerdrClient("/sock", "p", {
      connect: () => {
        throw new Error("no socket")
      },
    })
    await expect(client.send("pane.report_agent", {})).rejects.toThrow(/two attempts/)
  })

  test("#given an error response #then the attempt fails", async () => {
    const requests: Record<string, unknown>[] = []
    const client = new HerdrClient("/sock", "p", {
      connect: answeringConnect(requests, (request) => ({ id: request.id, error: { message: "nope" } })),
      firstAttemptTimeoutMs: 5,
      secondAttemptTimeoutMs: 5,
    })
    await expect(client.send("pane.report_agent", {})).rejects.toThrow(/two attempts/)
  })
})

describe("herdrSocketTarget", () => {
  test("#given a unix path #then it passes through; win32 bare names map to the pipe root", () => {
    expect(herdrSocketTarget("/tmp/h.sock", "linux")).toBe("/tmp/h.sock")
    expect(herdrSocketTarget("herdr-abc", "win32")).toBe("\\\\.\\pipe\\herdr-abc")
    expect(herdrSocketTarget("\\\\.\\pipe\\herdr-abc", "win32")).toBe("\\\\.\\pipe\\herdr-abc")
  })
})
