import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  isInsideTmux,
  isServerRunning,
  resetServerCheck,
  spawnTmuxPane,
  closeTmuxPane,
  applyLayout,
} from "./tmux-utils"

describe("isInsideTmux", () => {
  test("returns true when TMUX env is set", () => {
    // #given
    const originalTmux = process.env.TMUX
    process.env.TMUX = "/tmp/tmux-1000/default"

    // #when
    const result = isInsideTmux()

    // #then
    expect(result).toBe(true)

    // cleanup
    process.env.TMUX = originalTmux
  })

  test("returns false when TMUX env is not set", () => {
    // #given
    const originalTmux = process.env.TMUX
    delete process.env.TMUX

    // #when
    const result = isInsideTmux()

    // #then
    expect(result).toBe(false)

    // cleanup
    process.env.TMUX = originalTmux
  })

  test("returns false when TMUX env is empty string", () => {
    // #given
    const originalTmux = process.env.TMUX
    process.env.TMUX = ""

    // #when
    const result = isInsideTmux()

    // #then
    expect(result).toBe(false)

    // cleanup
    process.env.TMUX = originalTmux
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
    // #given
    globalThis.fetch = mock(async () => ({ ok: true })) as any

    // #when
    const result = await isServerRunning("http://localhost:4096")

    // #then
    expect(result).toBe(true)
  })

  test("returns false when server not reachable", async () => {
    // #given
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as any

    // #when
    const result = await isServerRunning("http://localhost:4096")

    // #then
    expect(result).toBe(false)
  })

  test("returns false when fetch returns not ok", async () => {
    // #given
    globalThis.fetch = mock(async () => ({ ok: false })) as any

    // #when
    const result = await isServerRunning("http://localhost:4096")

    // #then
    expect(result).toBe(false)
  })

  test("caches successful result", async () => {
    // #given
    const fetchMock = mock(async () => ({ ok: true })) as any
    globalThis.fetch = fetchMock

    // #when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // #then - should only call fetch once due to caching
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  test("does not cache failed result", async () => {
    // #given
    const fetchMock = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as any
    globalThis.fetch = fetchMock

    // #when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // #then - should call fetch 4 times (2 attempts per call, 2 calls)
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  test("uses different cache for different URLs", async () => {
    // #given
    const fetchMock = mock(async () => ({ ok: true })) as any
    globalThis.fetch = fetchMock

    // #when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:5000")

    // #then - should call fetch twice for different URLs
    expect(fetchMock.mock.calls.length).toBe(2)
  })
})

describe("resetServerCheck", () => {
  test("clears cache without throwing", () => {
    // #given, #when, #then
    expect(() => resetServerCheck()).not.toThrow()
  })

  test("allows re-checking after reset", async () => {
    // #given
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async () => ({ ok: true })) as any
    globalThis.fetch = fetchMock

    // #when
    await isServerRunning("http://localhost:4096")
    resetServerCheck()
    await isServerRunning("http://localhost:4096")

    // #then - should call fetch twice after reset
    expect(fetchMock.mock.calls.length).toBe(2)

    // cleanup
    globalThis.fetch = originalFetch
  })
})

describe("tmux pane functions", () => {
  test("spawnTmuxPane is exported as function", async () => {
    // #given, #when
    const result = typeof spawnTmuxPane

    // #then
    expect(result).toBe("function")
  })

  test("closeTmuxPane is exported as function", async () => {
    // #given, #when
    const result = typeof closeTmuxPane

    // #then
    expect(result).toBe("function")
  })

  test("applyLayout is exported as function", async () => {
    // #given, #when
    const result = typeof applyLayout

    // #then
    expect(result).toBe("function")
  })
})
