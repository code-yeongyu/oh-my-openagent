import { describe, expect, it } from "bun:test"
import pluginModule from "./index"

describe("oh-my-openagent v2 export shape", () => {
  it("exposes id, setup, and server from the default export", () => {
    // given the dual v1/v2 default export
    // when inspected
    // then v2 shape and v1 shape are both present
    expect(pluginModule.id).toBe("oh-my-openagent")
    expect(typeof (pluginModule as { setup?: unknown }).setup).toBe("function")
    expect(typeof pluginModule.server).toBe("function")
  })
})
