import { describe, expect, it, mock } from "bun:test"
import { createV2Setup } from "./v2-setup"

function buildCtx(): Parameters<ReturnType<typeof createV2Setup>>[0] {
  return {
    location: {
      directory: "/tmp/proj",
      project: { id: "proj-1" },
    },
  } as unknown as Parameters<ReturnType<typeof createV2Setup>>[0]
}

describe("#given v2 setup factory", () => {
  describe("#when setup runs with minimal ctx", () => {
    it("#then logs directory and returns cleanup", () => {
      // given
      const logged: Array<{ message: string; context: unknown }> = []
      const logMock = mock((message: string, context?: unknown) => {
        logged.push({ message, context })
      })
      const setup = createV2Setup({ log: logMock as unknown as Parameters<typeof createV2Setup>[0]["log"] })

      // when
      const cleanup = setup(buildCtx())

      // then
      expect(logged.length).toBe(1)
      expect(logged[0]?.message).toContain("V2 setup loaded")
      expect(typeof cleanup).toBe("function")
      expect(() => cleanup()).not.toThrow()
    })
  })
})
