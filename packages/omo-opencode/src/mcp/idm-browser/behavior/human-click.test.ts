import { describe, test, expect } from "bun:test"
import type { Page } from "playwright-core"
import { humanClick } from "./human-click"

type RecordedMouse = {
  moves: Array<{ x: number; y: number; steps: number | undefined }>
  clicks: Array<{ x: number; y: number }>
}

function createFakeMouse(rec: RecordedMouse) {
  return {
    move: async (x: number, y: number, opts?: { steps?: number }) => {
      rec.moves.push({ x, y, steps: opts?.steps })
    },
    click: async (x: number, y: number) => {
      rec.clicks.push({ x, y })
    },
  }
}

function createFakePage(): { page: Page; rec: RecordedMouse } {
  const rec: RecordedMouse = { moves: [], clicks: [] }
  const mouse = createFakeMouse(rec)
  const page = {
    mouse,
    waitForSelector: async () => ({
      boundingBox: async () => ({ x: 100, y: 200, width: 50, height: 20 }),
    }),
  } as unknown as Page
  return { page, rec }
}

describe("humanClick", () => {
  describe("#given coord-only target #when called", () => {
    test("#then click coordinates are within jitter range of input", async () => {
      const { page, rec } = createFakePage()
      await humanClick(page, { x: 400, y: 500 }, { jitterPx: 0, preClickDelayMs: 0 })
      expect(rec.clicks).toHaveLength(1)
      expect(rec.clicks[0]).toEqual({ x: 400, y: 500 })
    })

    test("#then move is called before click with positive steps", async () => {
      const { page, rec } = createFakePage()
      await humanClick(page, { x: 50, y: 50 }, { jitterPx: 0, preClickDelayMs: 0 })
      expect(rec.moves).toHaveLength(1)
      expect(rec.moves[0]?.steps).toBeGreaterThan(0)
    })

    test("#then jitter is bounded by jitterPx", async () => {
      const { page, rec } = createFakePage()
      const jitter = 5
      await humanClick(page, { x: 100, y: 100 }, { jitterPx: jitter, preClickDelayMs: 0 })
      const click = rec.clicks[0]!
      expect(Math.abs(click.x - 100)).toBeLessThanOrEqual(jitter)
      expect(Math.abs(click.y - 100)).toBeLessThanOrEqual(jitter)
    })
  })

  describe("#given selector target #when called", () => {
    test("#then resolves bounding box and clicks center +/- jitter", async () => {
      const { page, rec } = createFakePage()
      await humanClick(page, "button.submit", { jitterPx: 0, preClickDelayMs: 0 })
      expect(rec.clicks).toHaveLength(1)
      expect(rec.clicks[0]).toEqual({ x: 125, y: 210 })
    })
  })
})
