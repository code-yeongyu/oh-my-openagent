import { describe, expect, it } from "bun:test"
import tuiModule from "../tui"
import { setupV2Tui } from "./tui-setup"

describe("OpenCode 2.x TUI entry", () => {
  describe("#given the TUI default export", () => {
    it("#when both loaders inspect it #then it carries the 1.x tui callback and the 2.x setup callback", () => {
      // given
      const moduleShape = tuiModule

      // when
      const keys = Object.keys(moduleShape)

      // then
      expect(moduleShape.id).toBe("oh-my-openagent:tui")
      expect(typeof moduleShape.tui).toBe("function")
      expect(typeof moduleShape.setup).toBe("function")
      expect(keys).not.toContain("server")
    })
  })

  describe("#given a 2.x TUI context", () => {
    it("#when setup runs #then it completes without throwing and without touching the context", async () => {
      // given
      const context = new Proxy(
        {},
        {
          get() {
            throw new Error("setup must not read the 2.x TUI context yet")
          },
        },
      )

      // when
      const result = setupV2Tui(context)

      // then
      await expect(result).resolves.toBeUndefined()
    })
  })
})
