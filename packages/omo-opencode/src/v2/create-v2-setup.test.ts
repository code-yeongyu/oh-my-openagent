import { describe, expect, it, mock } from "bun:test"
import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./context-types"
import { createV2Setup } from "./create-v2-setup"
import { V2UnsupportedOperationError } from "./unsupported-operation-error"

function createContext(overrides: Partial<V2PluginContext> = {}): V2PluginContext {
  return {
    app: { name: "cli", version: "2.0.28", channel: "latest" },
    location: {
      directory: "/work/app/packages/web",
      project: { id: "proj_1", directory: "/work/app", canonical: "/work/app" },
    },
    options: { greeting: "hello" },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    ...overrides,
  }
}

describe("createV2Setup", () => {
  describe("#given a V2 plugin context", () => {
    it("#when setup runs #then the V1 server plugin receives a PluginInput built from the context", async () => {
      // given
      const captured: { input?: PluginInput; options?: PluginOptions } = {}
      const serverPlugin = mock(async (input: PluginInput, options?: PluginOptions): Promise<Hooks> => {
        captured.input = input
        captured.options = options
        return {}
      })
      const setup = createV2Setup({ serverPlugin })

      // when
      await setup(createContext())

      // then
      expect(serverPlugin).toHaveBeenCalledTimes(1)
      expect(captured.input?.directory).toBe("/work/app/packages/web")
      expect(captured.input?.worktree).toBe("/work/app")
      expect(captured.input?.project.id).toBe("proj_1")
      expect(captured.options).toEqual({ greeting: "hello" })
    })

    it("#when the server plugin returns a dispose hook #then the setup cleanup runs it exactly once", async () => {
      // given
      const dispose = mock(async () => {})
      const setup = createV2Setup({ serverPlugin: async () => ({ dispose }) as Hooks })

      // when
      const cleanup = await setup(createContext())
      await cleanup()
      await cleanup()

      // then
      expect(dispose).toHaveBeenCalledTimes(1)
    })

    it("#when the server plugin throws #then setup rejects with the original error", async () => {
      // given
      const failure = new Error("config invalid")
      const setup = createV2Setup({
        serverPlugin: async () => {
          throw failure
        },
      })

      // when
      const result = setup(createContext())

      // then
      await expect(result).rejects.toBe(failure)
    })
  })

  describe("#given a V1 client method with no V2 mapping", () => {
    it("#when it is called #then it rejects with an error naming the exact operation", async () => {
      // given
      let client: PluginInput["client"] | undefined
      const setup = createV2Setup({
        serverPlugin: async (input) => {
          client = input.client
          return {}
        },
      })
      await setup(createContext())

      // when
      const call = client?.session.todo({ path: { id: "ses_1" } })

      // then
      await expect(call).rejects.toBeInstanceOf(V2UnsupportedOperationError)
      await expect(call).rejects.toMatchObject({ operation: "client.session.todo" })
    })

    it("#when the client is awaited directly #then it is not mistaken for a thenable", async () => {
      // given
      let client: PluginInput["client"] | undefined
      const setup = createV2Setup({
        serverPlugin: async (input) => {
          client = input.client
          return {}
        },
      })
      await setup(createContext())

      // when
      const resolved = await Promise.resolve(client)

      // then
      expect(resolved).toBe(client)
    })
  })
})
