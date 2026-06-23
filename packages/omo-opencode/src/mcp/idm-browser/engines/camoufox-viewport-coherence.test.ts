import { describe, test, expect, mock } from "bun:test"
import { attachViewportCoherence, type WindowSize } from "./camoufox-viewport-coherence"

type FakePage = {
  setViewportSize: (size: { width: number; height: number }) => Promise<void>
}

type FakeContext = {
  pages: () => FakePage[]
  on: (event: string, handler: (page: FakePage) => void) => void
}

function makeFakeContext(initialPages: FakePage[] = []): {
  ctx: FakeContext
  pageHandler: { current: ((page: FakePage) => void) | null }
} {
  const pageHandler = { current: null as ((page: FakePage) => void) | null }
  const ctx: FakeContext = {
    pages: () => initialPages,
    on: (event, handler) => {
      if (event === "page") pageHandler.current = handler as (page: FakePage) => void
    },
  }
  return { ctx, pageHandler }
}

describe("camoufox-viewport-coherence", () => {
  describe("attachViewportCoherence", () => {
    test("#given no window size #when attached #then no-op", () => {
      const { ctx, pageHandler } = makeFakeContext()
      attachViewportCoherence(ctx as unknown as Parameters<typeof attachViewportCoherence>[0], undefined)
      expect(pageHandler.current).toBeNull()
    })

    test("#given window size and existing pages #when attached #then sets viewport on each", async () => {
      const setViewportSize = mock(async () => {})
      const page: FakePage = { setViewportSize }
      const { ctx } = makeFakeContext([page])
      const window: WindowSize = [1280, 720]
      attachViewportCoherence(ctx as unknown as Parameters<typeof attachViewportCoherence>[0], window)
      await new Promise((r) => setTimeout(r, 0))
      expect(setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 })
    })

    test("#given new page event fires #when attached #then sets viewport on incoming page", async () => {
      const setViewportSize = mock(async () => {})
      const newPage: FakePage = { setViewportSize }
      const { ctx, pageHandler } = makeFakeContext()
      const window: WindowSize = [1920, 1080]
      attachViewportCoherence(ctx as unknown as Parameters<typeof attachViewportCoherence>[0], window)
      pageHandler.current?.(newPage)
      await new Promise((r) => setTimeout(r, 0))
      expect(setViewportSize).toHaveBeenCalledWith({ width: 1920, height: 1080 })
    })

    test("#given setViewportSize throws #when applied #then swallows error gracefully", async () => {
      const setViewportSize = mock(async () => {
        throw new Error("page closed")
      })
      const page: FakePage = { setViewportSize }
      const { ctx } = makeFakeContext([page])
      const window: WindowSize = [800, 600]
      expect(() => {
        attachViewportCoherence(ctx as unknown as Parameters<typeof attachViewportCoherence>[0], window)
      }).not.toThrow()
      await new Promise((r) => setTimeout(r, 0))
      expect(setViewportSize).toHaveBeenCalled()
    })
  })
})
