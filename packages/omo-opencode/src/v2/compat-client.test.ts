import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { createV1CompatContext } from "./compat-client"

function buildV2(): Plugin.Context {
  const store = new Map<string, unknown>()
  return {
    location: {
      directory: "/proj",
      project: { id: "proj-1", directory: "/proj", canonical: "/proj" },
    },
    storage: {
      get: async (key: string) => store.get(key) as never,
      set: async (key: string, value: never) => {
        store.set(key, value)
      },
      remove: async (key: string) => {
        store.delete(key)
      },
      scan: async (options: { prefix: string }) => ({
        entries: [...store.entries()]
          .filter(([key]) => key.startsWith(options.prefix))
          .map(([key, value]) => ({ key, value: value as never })),
        next: undefined,
      }),
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({
        id: sessionID,
        title: "hello",
        time: { created: 1, updated: 2 },
      }),
      context: async () => [{ id: "m1", type: "user", time: { created: 1 }, text: "hi" }],
      create: async (input: { title?: string }) => ({ id: "child-1", title: input.title }),
      prompt: async () => ({ id: "inbox-1" }),
      wait: async () => {},
      interrupt: async () => ({ interrupted: true }),
      generate: async () => ({ text: "summary-text" }),
      update: async () => {},
      switchAgent: async () => {},
      switchModel: async () => {},
    },
    event: {
      subscribe: async function* () {},
    },
    model: {
      default: async () => ({ data: { providerID: "anthropic", modelID: "claude" } }),
      list: async () => ({
        data: [{ id: "anthropic/claude", modelID: "claude", providerID: "anthropic" }],
      }),
    },
    agent: {
      list: async () => ({ data: [{ id: "sisyphus", name: "sisyphus" }] }),
    },
    provider: {
      list: async () => ({ data: [{ id: "anthropic", activation: "enabled" }] }),
    },
  } as unknown as Plugin.Context
}

describe("#given V1 compat context over mocked V2", () => {
  describe("#when calling session methods", () => {
    it("#then envelopes match V1 shapes", async () => {
      // given
      const ctx = createV1CompatContext(buildV2())
      const client = ctx.client as unknown as Record<string, Record<string, (args?: unknown) => Promise<unknown>>>

      // when
      const got = (await client["session"]?.["get"]?.({ path: { id: "ses-1" } })) as {
        data: { title: string }
        error: null
      }
      const messages = (await client["session"]?.["messages"]?.({ path: { id: "ses-1" } })) as {
        data: Array<{ info: { role: string }; parts: unknown[] }>
      }
      const status = (await client["session"]?.["status"]?.()) as { data: Record<string, unknown> }
      const created = (await client["session"]?.["create"]?.({
        body: { parentID: "ses-1", title: "child" },
        query: { directory: "/proj" },
      })) as { data: { id: string }; error: null }
      const children = (await client["session"]?.["children"]?.({ path: { id: "ses-1" } })) as {
        data: Array<{ id: string }>
      }
      const listed = (await client["session"]?.["list"]?.()) as { data: Array<{ id: string }> }
      const summarized = (await client["session"]?.["summarize"]?.({ path: { id: "ses-1" } })) as {
        data: { summary: string }
      }
      const prompted = (await client["session"]?.["promptAsync"]?.({
        path: { id: "ses-1" },
        body: { parts: [{ type: "text", text: "go" }] },
      })) as { error: null }

      // then
      expect(got.data.title).toBe("hello")
      expect(messages.data[0]?.info.role).toBe("user")
      expect(status.data).toEqual({})
      expect(created.data.id).toBe("child-1")
      expect(children.data).toEqual([{ id: "child-1" }])
      expect(listed.data.map((item) => item.id)).toEqual(["child-1"])
      expect(summarized.data.summary).toBe("summary-text")
      expect(prompted.error).toBeNull()
    })
  })

  describe("#when calling provider and model lists", () => {
    it("#then V1 cache shapes are preserved", async () => {
      // given
      const ctx = createV1CompatContext(buildV2())
      const client = ctx.client as unknown as Record<string, Record<string, (args?: unknown) => Promise<unknown>>>

      // when
      const providers = (await client["provider"]?.["list"]?.()) as {
        data: { connected: string[]; all: Array<{ id: string; models?: Record<string, { id: string }> }> }
      }
      const models = (await client["model"]?.["list"]?.()) as {
        data: Array<{ provider: string; id: string }>
      }
      const config = (await client["config"]?.["get"]?.()) as { data: { model?: string } }

      // then
      expect(providers.data.connected).toEqual(["anthropic"])
      expect(providers.data.all[0]?.models).toEqual({ claude: { id: "claude" } })
      expect(models.data[0]).toMatchObject({ provider: "anthropic", id: "claude" })
      expect(config.data.model).toBe("anthropic/claude")
    })
  })
})
