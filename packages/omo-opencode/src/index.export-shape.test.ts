import { describe, expect, it } from "bun:test"
import pluginModule, { omoPlugin } from "./index"

describe("oh-my-openagent plugin export shape", () => {
  it("default-exports a plugin V1 calls through server and V2 calls through setup", () => {
    // given / when / then
    expect(pluginModule.id).toBe("oh-my-openagent")
    expect(typeof pluginModule.setup).toBe("function")
    expect(typeof pluginModule.server).toBe("function")
    expect(pluginModule.server).toBe(omoPlugin)
  })
})
