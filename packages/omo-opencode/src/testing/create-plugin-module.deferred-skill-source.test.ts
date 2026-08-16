import { describe, expect, test } from "bun:test"
import { createPluginModule } from "./create-plugin-module"

/**
 * Startup regression test: the plugin factory must NOT stall opencode's
 * session boot on the runtime security skill source server (MCP handshake).
 *
 * RED (before fix): the factory `await`s `createRuntimeSkillSourceServer`
 * unbounded, so a slow server (5000ms mock) stalls the factory past the
 * 2000ms race and the test fails with "factory awaited the runtime skill
 * source server".
 *
 * GREEN (after fix A3): the skill source handshake is bounded by a 500ms
 * `Promise.race` timeout — the factory returns hooks well inside the test
 * window and the server is still invoked (spy assertion).
 */
describe("createPluginModule deferred runtime skill source", () => {
  test("factory returns hooks within a bound even when the skill source server is slow", async () => {
    let serverStarted = false
    const slowSkillSource = async () => {
      serverStarted = true
      return new Promise((resolve) => setTimeout(() => resolve({ url: "mock://skills", stop: () => {} }), 5000))
    }

    const mod = createPluginModule({
      createRuntimeSkillSourceServer: slowSkillSource as never,
    })

    const client = {
      session: { promptAsync: async () => ({}) },
      tui: { showToast: async () => ({}) },
    }

    const hooks = await Promise.race([
      mod.server({ client: client as never, directory: process.cwd() } as never, {}),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("factory awaited the runtime skill source server")), 2000),
      ),
    ])

    expect(serverStarted).toBe(true)
    expect(hooks).toBeDefined()
    expect(typeof hooks).toBe("object")
  })
})
