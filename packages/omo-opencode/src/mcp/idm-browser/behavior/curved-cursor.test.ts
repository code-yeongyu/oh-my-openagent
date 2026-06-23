import { describe, test, expect, mock } from "bun:test"
import type { CurvedCursorDefaults, HumanCursor } from "./curved-cursor"

describe("curved-cursor", () => {
  describe("CurvedCursorDefaults type", () => {
    test("#given empty defaults #when typed #then compiles", () => {
      const d: CurvedCursorDefaults = {}
      expect(d).toBeDefined()
    })

    test("#given full defaults #when typed #then accepts all fields", () => {
      const d: CurvedCursorDefaults = {
        hesitateMsRange: [50, 200],
        waitForClickMsRange: [40, 100],
        paddingPercentage: 25,
        overshootThreshold: 600,
        moveDelayMsRange: [80, 240],
        performIdleMoves: true,
      }
      expect(d.paddingPercentage).toBe(25)
      expect(d.hesitateMsRange?.[0]).toBe(50)
    })
  })

  describe("createCurvedCursor", () => {
    test("#given mocked module #when called #then returns object with click/move/moveTo", async () => {
      mock.module("ghost-cursor-playwright-port", () => ({
        createCursor: () => ({
          click: async () => {},
          move: async () => {},
          moveTo: async () => {},
          scroll: async () => {},
          scrollTo: async () => {},
          scrollIntoView: async () => {},
          getElement: async () => ({}),
          getLocation: () => ({ x: 0, y: 0 }),
          toggleRandomMove: () => {},
        }) as HumanCursor,
      }))
      const { createCurvedCursor } = await import("./curved-cursor")
      const fakePage = {} as unknown as Parameters<typeof createCurvedCursor>[0]
      const cursor = createCurvedCursor(fakePage, { paddingPercentage: 30 })
      expect(typeof cursor.click).toBe("function")
      expect(typeof cursor.move).toBe("function")
      expect(typeof cursor.moveTo).toBe("function")
    })
  })
})
