import { describe, expect, it } from "bun:test"
import pluginModule, { omoPlugin } from "./index"

describe("oh-my-openagent plugin export shape", () => {
  it("keeps default module and named server exports aligned", () => {
    // given
    const defaultServer = pluginModule.server

    // when
    const namedServer = omoPlugin

    // then
    expect(typeof defaultServer).toBe("function")
    expect(namedServer).toBe(defaultServer)
  })

  it("exposes the OpenCode 1.x server entry and the 2.x setup entry on one default export", () => {
    // given
    const moduleShape = pluginModule

    // when
    const keys = Object.keys(moduleShape)

    // then
    expect(moduleShape.id).toBe("oh-my-openagent")
    expect(typeof moduleShape.server).toBe("function")
    expect(typeof moduleShape.setup).toBe("function")
    expect(keys).not.toContain("tui")
  })
})
