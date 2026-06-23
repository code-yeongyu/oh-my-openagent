import { describe, test, expect } from "bun:test"
import type { BrowserPool, PooledSession } from "../../pool"
import type { Page } from "playwright-core"
import { handleClickAt } from "./click-at-handler"

type Recorded = {
  moves: Array<{ x: number; y: number }>
  clicks: Array<{ x: number; y: number; button?: string; delay?: number }>
  modifiersDown: string[]
  modifiersUp: string[]
}

function createFakePool(rec: Recorded): { pool: BrowserPool; sessionId: string } {
  const sessionId = "test-session"
  const page = {
    mouse: {
      move: async (x: number, y: number) => {
        rec.moves.push({ x, y })
      },
      click: async (
        x: number,
        y: number,
        opts?: { button?: string; delay?: number },
      ) => {
        rec.clicks.push({ x, y, ...(opts ?? {}) })
      },
    },
    keyboard: {
      down: async (key: string) => { rec.modifiersDown.push(key) },
      up: async (key: string) => { rec.modifiersUp.push(key) },
    },
  } as unknown as Page

  const session = { id: sessionId, page } as unknown as PooledSession

  const pool = {
    acquire: async () => session,
    release: async () => undefined,
    shutdown: async () => undefined,
    getSessionCount: () => 1,
    hasSession: () => true,
    listSessions: async () => [],
    getSession: () => session,
  } as unknown as BrowserPool

  return { pool, sessionId }
}

function newRec(): Recorded {
  return { moves: [], clicks: [], modifiersDown: [], modifiersUp: [] }
}

describe("handleClickAt", () => {
  describe("#given coords without humanize #when called", () => {
    test("#then click lands at exact (x, y)", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      const result = await handleClickAt(pool, { x: 314, y: 159 })
      expect(rec.clicks).toHaveLength(1)
      expect(rec.clicks[0]?.x).toBe(314)
      expect(rec.clicks[0]?.y).toBe(159)
      expect(result.isError).toBeUndefined()
    })

    test("#then button defaults to left and delay falls in 80..180 ms", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      await handleClickAt(pool, { x: 1, y: 1 })
      const c = rec.clicks[0]!
      expect(c.button === undefined || c.button === "left").toBe(true)
      expect(c.delay).toBeGreaterThanOrEqual(80)
      expect(c.delay).toBeLessThanOrEqual(180)
    })

    test("#then explicit delay_ms overrides random default", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      await handleClickAt(pool, { x: 1, y: 1, delay_ms: 42 })
      expect(rec.clicks[0]?.delay).toBe(42)
    })

    test("#then modifiers held via keyboard.down/up around right-button click", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      await handleClickAt(pool, {
        x: 1,
        y: 1,
        button: "right",
        modifiers: ["Shift", "Meta"],
      })
      expect(rec.clicks[0]?.button).toBe("right")
      expect(rec.modifiersDown).toEqual(["Shift", "Meta"])
      expect(rec.modifiersUp).toEqual(["Meta", "Shift"])
    })
  })

  describe("#given humanize=true #when called", () => {
    test("#then mouse.move runs before click and click is within jitter range", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      await handleClickAt(pool, { x: 500, y: 500, humanize: true })
      expect(rec.moves.length).toBeGreaterThan(0)
      expect(rec.clicks).toHaveLength(1)
      expect(Math.abs((rec.clicks[0]?.x ?? 0) - 500)).toBeLessThanOrEqual(5)
      expect(Math.abs((rec.clicks[0]?.y ?? 0) - 500)).toBeLessThanOrEqual(5)
    })
  })

  describe("#given coords are negative #when called", () => {
    test("#then result is error and no click recorded", async () => {
      const rec = newRec()
      const { pool } = createFakePool(rec)
      const result = await handleClickAt(pool, { x: -10, y: 5 })
      expect(result.isError).toBe(true)
      expect(rec.clicks).toHaveLength(0)
    })
  })
})
