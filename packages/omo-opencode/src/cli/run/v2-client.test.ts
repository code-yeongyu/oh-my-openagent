import { describe, expect, test } from "bun:test"

import { createV2RunClient, type V2RunTransport } from "./v2-client"

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
