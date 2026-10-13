import { describe, expect, it, mock } from "bun:test"
import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./context-types"
import { createV2Setup } from "./create-v2-setup"
import { createFakePluginContext } from "./fake-plugin-context"
import { V2UnsupportedOperationError } from "./unsupported-operation-error"

function createContext(overrides: Partial<V2PluginContext> = {}): V2PluginContext {
  return {
    ...createFakePluginContext({ directory: "/work/app/packages/web" }).context,
    options: { greeting: "hello" },
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
      const call = client?.session.list()

      // then
      await expect(call).rejects.toBeInstanceOf(V2UnsupportedOperationError)
      await expect(call).rejects.toMatchObject({ operation: "client.session.list" })
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
  describe("#given 2.x session events", () => {
    async function until(predicate: () => boolean): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error("condition was not met in time")
    }

    it("#when a turn runs #then the plugin's event hook sees the 1.x events and client.session.status follows", async () => {
      // given
      const fake = createFakePluginContext()
      const seen: string[] = []
      let client: PluginInput["client"] | undefined
      const setup = createV2Setup({
        serverPlugin: async (input) => {
          client = input.client
          return { event: async ({ event }) => void seen.push(event.type) } as Hooks
        },
      })
      await setup({ ...fake.context, options: {} })
      await until(() => fake.activeSubscribers() === 1)

      // when
      fake.emit({ type: "session.execution.started", data: { sessionID: "ses_1" } })
      await until(() => seen.length === 1)
      const busy = await client?.session.status()
      fake.emit({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
      await until(() => seen.length === 3)
      const idle = await client?.session.status()

      // then
      expect(seen).toEqual(["session.status", "session.status", "session.idle"])
      expect(busy?.data).toEqual({ ses_1: { type: "busy" } })
      expect(idle?.data).toEqual({})
    })

    it("#when the cleanup runs #then the event subscription ends", async () => {
      // given
      const fake = createFakePluginContext()
      const setup = createV2Setup({ serverPlugin: async () => ({}) as Hooks })
      const cleanup = await setup({ ...fake.context, options: {} })
      await until(() => fake.activeSubscribers() === 1)

      // when
      await cleanup()

      // then
      await until(() => fake.activeSubscribers() === 0)
    })

    it("#when the server plugin fails to initialise #then no event subscription is left behind", async () => {
      // given
      const fake = createFakePluginContext()
      const setup = createV2Setup({
        serverPlugin: async () => {
          throw new Error("config invalid")
        },
      })

      // when
      await setup({ ...fake.context, options: {} }).catch(() => {})

      // then
      await until(() => fake.activeSubscribers() === 0)
    })
  })
})
