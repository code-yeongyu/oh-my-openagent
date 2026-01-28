import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import {
  isInsideTmux,
  isServerRunning,
  resetServerCheck,
  spawnTmuxPane,
  closeTmuxPane,
  applyLayout,
  getCurrentPaneId,
} from "./tmux-utils"

describe("isInsideTmux", () => {
  let savedTmux: string | undefined
  let savedZellij: string | undefined
  let savedZellijSession: string | undefined

  beforeEach(() => {
    savedTmux = process.env.TMUX
    savedZellij = process.env.ZELLIJ
    savedZellijSession = process.env.ZELLIJ_SESSION_NAME
    process.env.TMUX = ""
    process.env.ZELLIJ = ""
    process.env.ZELLIJ_SESSION_NAME = ""
  })

  afterEach(() => {
    if (savedTmux !== undefined) {
      process.env.TMUX = savedTmux
    } else {
      delete process.env.TMUX
    }
    if (savedZellij !== undefined) {
      process.env.ZELLIJ = savedZellij
    } else {
      delete process.env.ZELLIJ
    }
    if (savedZellijSession !== undefined) {
      process.env.ZELLIJ_SESSION_NAME = savedZellijSession
    } else {
      delete process.env.ZELLIJ_SESSION_NAME
    }
  })

  test("returns true when TMUX env is set", () => {
    //#given TMUX is set
    process.env.TMUX = "/tmp/tmux-1000/default"

    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return true
    expect(result).toBe(true)
  })

  test("returns false when no multiplexer env vars are set", () => {
    //#given no multiplexer env vars are set (cleared in beforeEach)
    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return false
    expect(result).toBe(false)
  })

  test("returns false when TMUX env is empty string", () => {
    //#given all env vars are empty strings (set in beforeEach)
    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return false
    expect(result).toBe(false)
  })

  test("returns true when ZELLIJ env is set", () => {
    //#given process.env.ZELLIJ is set
    process.env.ZELLIJ = "0.42.0"

    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return true
    expect(result).toBe(true)
  })

  test("returns true when ZELLIJ_SESSION_NAME env is set", () => {
    //#given process.env.ZELLIJ_SESSION_NAME is set
    process.env.ZELLIJ_SESSION_NAME = "erudite-brachiosaur"

    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return true
    expect(result).toBe(true)
  })

  test("returns true when both ZELLIJ and ZELLIJ_SESSION_NAME are set", () => {
    //#given both zellij env vars are set
    process.env.ZELLIJ = "0.42.0"
    process.env.ZELLIJ_SESSION_NAME = "erudite-brachiosaur"

    //#when isInsideTmux is called
    const result = isInsideTmux()

    //#then it should return true
    expect(result).toBe(true)
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
    globalThis.fetch = mock(async () => ({ ok: true })) as any

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(true)
  })

  test("returns false when server not reachable", async () => {
    // given
    globalThis.fetch = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as any

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(false)
  })

  test("returns false when fetch returns not ok", async () => {
    // given
    globalThis.fetch = mock(async () => ({ ok: false })) as any

    // when
    const result = await isServerRunning("http://localhost:4096")

    // then
    expect(result).toBe(false)
  })

  test("caches successful result", async () => {
    // given
    const fetchMock = mock(async () => ({ ok: true })) as any
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // then - should only call fetch once due to caching
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  test("does not cache failed result", async () => {
    // given
    const fetchMock = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as any
    globalThis.fetch = fetchMock

    // when
    await isServerRunning("http://localhost:4096")
    await isServerRunning("http://localhost:4096")

    // then - should call fetch 4 times (2 attempts per call, 2 calls)
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  test("uses different cache for different URLs", async () => {
    // given
    const fetchMock = mock(async () => ({ ok: true })) as any
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
    const fetchMock = mock(async () => ({ ok: true })) as any
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

describe("getCurrentPaneId", () => {
  let savedTmuxPane: string | undefined
  let savedZellijPaneId: string | undefined

  beforeEach(() => {
    savedTmuxPane = process.env.TMUX_PANE
    savedZellijPaneId = process.env.ZELLIJ_PANE_ID
    delete process.env.TMUX_PANE
    delete process.env.ZELLIJ_PANE_ID
  })

  afterEach(() => {
    if (savedTmuxPane !== undefined) {
      process.env.TMUX_PANE = savedTmuxPane
    } else {
      delete process.env.TMUX_PANE
    }
    if (savedZellijPaneId !== undefined) {
      process.env.ZELLIJ_PANE_ID = savedZellijPaneId
    } else {
      delete process.env.ZELLIJ_PANE_ID
    }
  })

  test("returns pane id when TMUX_PANE is set", () => {
    //#given process.env.TMUX_PANE is set
    process.env.TMUX_PANE = "%123"

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return the tmux pane id
    expect(result).toBe("%123")
  })

  test("returns pane id when ZELLIJ_PANE_ID is set", () => {
    //#given process.env.ZELLIJ_PANE_ID is set
    process.env.ZELLIJ_PANE_ID = "0"

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return the zellij pane id
    expect(result).toBe("0")
  })

  test("prioritizes TMUX_PANE over ZELLIJ_PANE_ID when both are set", () => {
    //#given both TMUX_PANE and ZELLIJ_PANE_ID are set
    process.env.TMUX_PANE = "%123"
    process.env.ZELLIJ_PANE_ID = "0"

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return the tmux pane id (priority)
    expect(result).toBe("%123")
  })

  test("returns undefined when neither is set", () => {
    //#given neither TMUX_PANE nor ZELLIJ_PANE_ID is set (cleared in beforeEach)
    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return undefined
    expect(result).toBeUndefined()
  })

  test("returns undefined when TMUX_PANE is empty string", () => {
    //#given TMUX_PANE is empty string
    process.env.TMUX_PANE = ""

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return undefined (empty string is falsy)
    expect(result).toBeUndefined()
  })

  test("returns undefined when ZELLIJ_PANE_ID is empty string", () => {
    //#given ZELLIJ_PANE_ID is empty string
    process.env.ZELLIJ_PANE_ID = ""

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return undefined (empty string is falsy)
    expect(result).toBeUndefined()
  })

  test("returns undefined when both are empty strings", () => {
    //#given both TMUX_PANE and ZELLIJ_PANE_ID are empty strings
    process.env.TMUX_PANE = ""
    process.env.ZELLIJ_PANE_ID = ""

    //#when getCurrentPaneId is called
    const result = getCurrentPaneId()

    //#then it should return undefined
    expect(result).toBeUndefined()
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
