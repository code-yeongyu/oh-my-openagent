import { describe, expect, test } from "bun:test"

import { createV2RunClient, httpTransport, type V2RunTransport } from "./v2-client"

describe("OpenCode V2 run client", () => {
  test("awaits agent, model, system, and prompt, and yields events", async () => {
    const calls: string[] = []
    const transport: V2RunTransport = {
      async switchAgent() {
        calls.push("agent")
      },
      async switchModel() {
        calls.push("model")
      },
      async synthetic() {
        calls.push("system")
      },
      async prompt() {
        calls.push("prompt")
        return { id: "inbox" }
      },
      async listSessions() {
        return []
      },
      async active() {
        return {}
      },
      events() {
        return (async function* source() {
          yield { type: "session.idle", data: { sessionID: "ses_1" } }
        })()
      },
    }
    const client = createV2RunClient({ transport })
    await client.session.promptAsync({
      path: { id: "ses_1" },
      body: {
        agent: "oracle",
        model: { providerID: "openai", modelID: "gpt" },
        variant: "high",
        system: "be brief",
        parts: [{ type: "text", text: "go" }],
      },
    })
    expect(calls).toEqual(["agent", "model", "system", "prompt"])
    const subscribed = await client.event.subscribe()
    const events = []
    for await (const event of subscribed.stream) events.push(event)
    expect(events[0]).toMatchObject({ type: "session.idle", properties: { sessionID: "ses_1" } })
  })
})

describe("OpenCode V2 run client attachments", () => {
  function recordingClient() {
    const prompts: Array<Parameters<V2RunTransport["prompt"]>[0]> = []
    const transport: V2RunTransport = {
      async switchAgent() {},
      async switchModel() {},
      async synthetic() {},
      async prompt(value) {
        prompts.push(value)
        return {}
      },
      async listSessions() {
        return []
      },
      async active() {
        return {}
      },
      events() {
        return (async function* empty() {})()
      },
    }
    return { client: createV2RunClient({ transport }), prompts }
  }

  test("forwards a file: part as files", async () => {
    const { client, prompts } = recordingClient()
    await client.session.prompt({
      path: { id: "ses_1" },
      body: { parts: [{ type: "text", text: "look" }, { type: "file", mime: "image/png", url: "file:///C:/x.png", filename: "x.png" }] },
    })
    expect(prompts).toEqual([{ sessionID: "ses_1", text: "look", files: [{ uri: "file:///C:/x.png", name: "x.png" }] }])
  })

  test("forwards a data: URL part as files", async () => {
    const { client, prompts } = recordingClient()
    await client.session.prompt({
      path: { id: "ses_1" },
      body: { parts: [{ type: "text", text: "look" }, { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "clip.png" }] },
    })
    expect(prompts[0]?.files?.[0]?.uri.startsWith("data:image/png;base64,")).toBe(true)
  })

  test("sends no files key for a text-only prompt", async () => {
    const { client, prompts } = recordingClient()
    await client.session.prompt({ path: { id: "ses_1" }, body: { parts: [{ type: "text", text: "go" }] } })
    expect(prompts).toEqual([{ sessionID: "ses_1", text: "go" }])
  })

  test("the HTTP transport puts files in the prompt request body only when present", async () => {
    const bodies: unknown[] = []
    const fetchImpl = (async (_url: URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    const transport = httpTransport("http://127.0.0.1:9", fetchImpl)
    await transport.prompt({ sessionID: "ses_1", text: "look", files: [{ uri: "file:///C:/x.png", name: "x.png" }] })
    await transport.prompt({ sessionID: "ses_1", text: "go" })
    expect(bodies).toEqual([{ text: "look", files: [{ uri: "file:///C:/x.png", name: "x.png" }] }, { text: "go" }])
  })
})
