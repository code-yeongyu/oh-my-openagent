import { describe, test, expect } from "bun:test"
import type { Page } from "playwright-core"
import { clickInsideIframe } from "./iframe-click"

type RecordedClicks = { coords: Array<{ x: number; y: number }> }

function createFakePage(boundingBox: { x: number; y: number; width: number; height: number } | null): { page: Page; rec: RecordedClicks } {
  const rec: RecordedClicks = { coords: [] }
  const page = {
    mouse: {
      move: async () => undefined,
      click: async (x: number, y: number) => {
        rec.coords.push({ x, y })
      },
    },
    waitForSelector: async (sel: string) => {
      if (sel.startsWith("iframe")) {
        return { boundingBox: async () => boundingBox }
      }
      return { boundingBox: async () => boundingBox }
    },
    $: async (sel: string) => {
      if (sel.startsWith("iframe")) {
        return { boundingBox: async () => boundingBox }
      }
      return null
    },
  } as unknown as Page
  return { page, rec }
}

describe("clickInsideIframe", () => {
  describe("#given iframe with known bbox #when offset clicked", () => {
    test("#then resolves to absolute viewport coords (iframe.x + offsetX, iframe.y + offsetY)", async () => {
      const { page, rec } = createFakePage({ x: 200, y: 300, width: 400, height: 400 })
      await clickInsideIframe(page, "iframe[src*='hcaptcha']", 50, 60, { jitterPx: 0, preClickDelayMs: 0 })
      expect(rec.coords).toHaveLength(1)
      expect(rec.coords[0]).toEqual({ x: 250, y: 360 })
    })
  })

  describe("#given missing iframe #when called", () => {
    test("#then throws with selector in message", async () => {
      const { page } = createFakePage(null)
      await expect(clickInsideIframe(page, "iframe.absent", 10, 10)).rejects.toThrow(/iframe.absent/)
    })
  })
})
