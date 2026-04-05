import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  isInsideTmux,
  isServerRunning,
  resetServerCheck,
  markServerRunningInProcess,
  spawnTmuxPane,
  closeTmuxPane,
  applyLayout,
} from "./tmux-utils"
import { isInsideTmuxEnvironment } from "./tmux-utils/environment"

function createFetchMock(responseFactory: () => Promise<Response>): typeof fetch & ReturnType<typeof mock> {
  const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => responseFactory())
  const preconnect = globalThis.fetch.preconnect?.bind(globalThis.fetch)
  return Object.assign(fetchMock, {
    preconnect,
  }) as typeof fetch & ReturnType<typeof mock>
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
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    resetServerCheck()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns true when server responds OK", async () => {
    // given
    globalThis.fetch = createFetchMock(async () => new Response(null, { status: 200 }))

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(true)
  })

  test("returns false when server not reachable", async () => {
    // given
    globalThis.fetch = createFetchMock(async () => {
      throw new Error("ECONNREFUSED")
    })

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(false)
  })

  test("returns false when fetch returns not ok", async () => {
    // given
    globalThis.fetch = createFetchMock(async () => new Response(null, { status: 500 }))

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(false)
  })

  test("caches successful result", async () => {
    // given
    const fetchMock = createFetchMock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // then - should only call fetch once due to caching
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  test("does not cache failed result", async () => {
    // given
    const fetchMock = createFetchMock(async () => {
      throw new Error("ECONNREFUSED")
    })
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // then - should call fetch 4 times (2 attempts per call, 2 calls)
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  test("uses different cache for different URLs", async () => {
    // given
    const fetchMock = createFetchMock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:5000")

    // then - should call fetch twice for different URLs
    expect(fetchMock.mock.calls.length).toBe(2)
  })
})

describe("resetServerCheck", () => {
  test("clears cache without throwing", () => {
    // given, #when, #then
    expect(() => resetServerCheck()).not.toThrow()
  })

  test("allows re-checking after reset", async () => {
    // given
    const originalFetch = globalThis.fetch
    const fetchMock = createFetchMock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    resetServerCheck()
    await isServerRunning("http://localhost:4096")

    // then - should call fetch twice after reset
    expect(fetchMock.mock.calls.length).toBe(2)

    // cleanup
    globalThis.fetch = originalFetch
  })
})

describe("markServerRunningInProcess", () => {
  const originalFetch = globalThis.fetch
  const SERVER_RUNNING_KEY = Symbol.for("oh-my-opencode:server-running-in-process")

  beforeEach(() => {
    resetServerCheck()
    delete (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY]
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY]
  })

  test("skips HTTP fetch when marked as running in-process", async () => {
    // given
    const fetchMock = createFetchMock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock
    markServerRunningInProcess()

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(true)
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("uses globalThis so flag survives across module instances", () => {
    // given
    markServerRunningInProcess()

    // when
    const flag = (globalThis as Record<symbol, boolean>)[SERVER_RUNNING_KEY]

    // then
    expect(flag).toBe(true)
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
