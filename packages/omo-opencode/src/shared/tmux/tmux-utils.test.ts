import { describe, test, expect, beforeEach } from "bun:test"
import {
  isInsideTmux,
  isServerRunning,
  resetServerCheck,
  spawnTmuxPane,
  closeTmuxPane,
  applyLayout,
} from "./tmux-utils"
import { isInsideTmuxEnvironment } from "./tmux-utils/environment"
import { createServerHealthStateForTesting } from "./tmux-utils/server-health"

function createFetchRecorder(responseFactory: () => Promise<Response>): typeof fetch & { calls: Array<[RequestInfo | URL, RequestInit | undefined]> } {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  const fetchRecorder = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([input, init])
    return await responseFactory()
  }
  const preconnect = globalThis.fetch.preconnect?.bind(globalThis.fetch)
  return Object.assign(fetchRecorder, {
    calls,
    preconnect,
  }) as typeof fetch & { calls: Array<[RequestInfo | URL, RequestInit | undefined]> }
}


describe("isInsideTmux", () => {
  test("returns true when TMUX env is set", () => {
    // given
    const environment = { TMUX: "/tmp/tmux-1000/default" }

    // when
    const result = isInsideTmuxEnvironment(environment)

    // then
    expect(result).toBe(true)
  })

  test("returns false when TMUX env is not set", () => {
    // given
    const environment = {}

    // when
    const result = isInsideTmuxEnvironment(environment)

    // then
    expect(result).toBe(false)
  })

  test("returns false when TMUX env is empty string", () => {
    // given
    const environment = { TMUX: "" }

    // when
    const result = isInsideTmuxEnvironment(environment)

    // then
    expect(result).toBe(false)
  })

  test("is exported as a function", () => {
    // given, #when
    const result = typeof isInsideTmux

    // then
    expect(result).toBe("function")
  })
})

describe("isServerRunning", () => {
  beforeEach(() => {
    resetServerCheck()
  })

  test("returns true when server responds OK", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 200 }))

    // when
    const result = await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then
    expect(result).toBe(true)
  })

  test("returns false when server not reachable", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => {
      throw new Error("ECONNREFUSED")
    })

    // when
    const result = await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then
    expect(result).toBe(false)
  })

  test("returns false when fetch returns not ok", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 500 }))

    // when
    const result = await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then
    expect(result).toBe(false)
  })

  test("performs an external health check even when the legacy in-process marker is set", async () => {
    // given
    const serverRunningKey = Symbol.for("oh-my-opencode:server-running-in-process")
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, serverRunningKey)
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 503 }))
    Reflect.set(globalThis, serverRunningKey, true)

    // when
    const result = await (async () => {
      try {
        return await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock })
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, serverRunningKey, originalDescriptor)
        }
        if (!originalDescriptor) {
          Reflect.deleteProperty(globalThis, serverRunningKey)
        }
      }
    })()

    // then
    const healthUrl = new URL("/global/health", "http://localhost:4096").toString()
    expect(result).toBe(false)
    expect(fetchMock.calls.some(([input]) => input.toString() === healthUrl)).toBe(true)
    expect(Object.getOwnPropertyDescriptor(globalThis, serverRunningKey)).toEqual(originalDescriptor)
  })

  test("caches successful result", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 200 }))

    // when
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then - should only call fetch once due to caching
    expect(fetchMock.calls.length).toBe(1)
  })

  test("does not cache failed result", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => {
      throw new Error("ECONNREFUSED")
    })

    // when
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then - should call fetch 4 times (2 attempts per call, 2 calls)
    expect(fetchMock.calls.length).toBe(4)
  })

  test("uses different cache for different URLs", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 200 }))

    // when
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })
    await isServerRunning("http://localhost:5000", { fetchImplementation: fetchMock, state })

    // then - should call fetch twice for different URLs
    expect(fetchMock.calls.length).toBe(2)
  })
})

describe("resetServerCheck", () => {
  test("clears cache without throwing", () => {
    // given, #when, #then
    expect(() => resetServerCheck()).not.toThrow()
  })

  test("allows re-checking after reset", async () => {
    // given
    const state = createServerHealthStateForTesting()
    const fetchMock = createFetchRecorder(async () => new Response(null, { status: 200 }))

    // when
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })
    state.serverAvailable = null
    state.serverCheckUrl = null
    await isServerRunning("http://localhost:4096", { fetchImplementation: fetchMock, state })

    // then - should call fetch twice after reset
    expect(fetchMock.calls.length).toBe(2)

  })
})

describe("tmux pane functions", () => {
  test("spawnTmuxPane is exported as function", async () => {
    // given, #when
    const result = typeof spawnTmuxPane

    // then
    expect(result).toBe("function")
  })

  test("closeTmuxPane is exported as function", async () => {
    // given, #when
    const result = typeof closeTmuxPane

    // then
    expect(result).toBe("function")
  })

  test("applyLayout is exported as function", async () => {
    // given, #when
    const result = typeof applyLayout

    // then
    expect(result).toBe("function")
  })
})
