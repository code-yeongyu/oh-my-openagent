import { describe, expect, test } from "bun:test"
import { createV2ClientBridge, type V2PluginClientSurface } from "./client-bridge"

interface Recording {
  calls: Array<Record<string, unknown>>
  response: unknown
  reject?: boolean
}

function recordingClient(): { surface: V2PluginClientSurface; record: (method: string) => Recording } {
  const recordings = new Map<string, Recording>()
  const record = (method: string): Recording => {
    const existing = recordings.get(method)
    if (existing) return existing
    const created: Recording = { calls: [], response: undefined }
    recordings.set(method, created)
    return created
  }
  const call = (method: string, input: Record<string, unknown>) => {
    const entry = record(method)
    entry.calls.push(input)
    if (entry.reject) return Promise.reject(new Error(String(entry.response ?? "failure")))
    return Promise.resolve(entry.response)
  }
  const surface = {
    agent: { list: (input: Record<string, unknown>) => call("agent.list", input) },
    config: { get: (input: Record<string, unknown>) => call("config.get", input) },
    model: { list: (input: Record<string, unknown>) => call("model.list", input) },
    session: {
      interrupt: (input: Record<string, unknown>) => call("session.interrupt", input),
      create: (input: Record<string, unknown>) => call("session.create", input),
      get: (input: Record<string, unknown>) => call("session.get", input),
      context: (input: Record<string, unknown>) => call("session.context", input),
      prompt: (input: Record<string, unknown>) => call("session.prompt", input),
      active: (input: Record<string, unknown>) => call("session.active", input),
    },
  } as unknown as V2PluginClientSurface
  return { surface, record }
}

describe("client-bridge", () => {
  describe("#given a healthy v2 plugin client", () => {
    test("wraps agent listing in a data envelope", async () => {
      // given
      const { surface, record } = recordingClient()
      record("agent.list").response = [{ name: "sisyphus" }]
      const bridge = createV2ClientBridge(surface)
      // when
      const result = await bridge.app.agents()
      // then
      expect(result).toEqual({ data: [{ name: "sisyphus" }] })
    })

    test("maps session.abort onto interrupt with a flat sessionID", async () => {
      const { surface, record } = recordingClient()
      record("session.interrupt").response = undefined
      const bridge = createV2ClientBridge(surface)
      await bridge.session.abort({ path: { id: "ses_1" } })
      expect(record("session.interrupt").calls[0]).toEqual({ sessionID: "ses_1" })
    })

    test("maps session.create body through and envelopes the new session", async () => {
      const { surface, record } = recordingClient()
      record("session.create").response = { id: "ses_new" }
      const bridge = createV2ClientBridge(surface)
      const result = await bridge.session.create({ body: { title: "t" } })
      expect(record("session.create").calls[0]).toEqual({ title: "t" })
      expect(result).toEqual({ data: { id: "ses_new" } })
    })

    test("maps session.get path id onto the flat input", async () => {
      const { surface, record } = recordingClient()
      record("session.get").response = { id: "ses_1" }
      const bridge = createV2ClientBridge(surface)
      await bridge.session.get({ path: { id: "ses_1" } })
      expect(record("session.get").calls[0]).toEqual({ sessionID: "ses_1" })
    })

    test("maps session.messages onto session.context", async () => {
      const { surface, record } = recordingClient()
      record("session.context").response = []
      const bridge = createV2ClientBridge(surface)
      await bridge.session.messages({ path: { id: "ses_9" } })
      expect(record("session.context").calls[0]).toEqual({ sessionID: "ses_9" })
    })

    test("routes both prompt and promptAsync onto the v2 prompt channel", async () => {
      const { surface, record } = recordingClient()
      record("session.prompt").response = {}
      const bridge = createV2ClientBridge(surface)
      await bridge.session.prompt?.({ path: { id: "ses_2" }, body: { text: "hi" } })
      await bridge.session.promptAsync?.({ path: { id: "ses_2" }, body: { text: "hi" } })
      expect(record("session.prompt").calls).toHaveLength(2)
    })

    test("maps session.status onto session.active", async () => {
      const { surface, record } = recordingClient()
      record("session.active").response = {}
      const bridge = createV2ClientBridge(surface)
      await bridge.session.status()
      expect(record("session.active").calls).toHaveLength(1)
    })
  })

  describe("#given a failing v2 call", () => {
    test("converts rejections into an error envelope instead of throwing", async () => {
      // given
      const { surface, record } = recordingClient()
      const failure = record("session.get")
      failure.reject = true
      failure.response = "host exploded"
      const bridge = createV2ClientBridge(surface)
      // when
      const result = await bridge.session.get({ path: { id: "ses_x" } })
      // then
      expect(result.data).toBeUndefined()
      expect((result.error as Error).message).toBe("host exploded")
    })
  })
})
